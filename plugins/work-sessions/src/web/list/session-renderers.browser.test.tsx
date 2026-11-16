import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { definePlugin, type PluginSdk } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { useDomainObjectState } from "@kilo-desktop/kernel/web";

import {
	WorkSessionDecoration,
	WorkSessions,
	WorkSessionsView,
	type WorkSession,
	type WorkSessionDecorationProps,
	type WorkSessionsViewProps,
} from "../../contracts";
import { chat, NOW, renderWorkSessions, workSession } from "../../testing";

const VIEW = "test.board/board";
const selectWorkSessions = (state: { workSessions: readonly WorkSession[] }) => state.workSessions;

/** A board drawing each work session with the session list's renderers, as a card. */
function Board({ renderers }: WorkSessionsViewProps) {
	const workSessions = useDomainObjectState(WorkSessions, selectWorkSessions) ?? [];
	const { Glyph, Status, Decorations, Menu } = renderers;
	return (
		<ul data-qa-id="board">
			{workSessions.map((workSession) => (
				<li key={workSession.id} data-qa-id={`card-${workSession.id}`}>
					<Glyph workSession={workSession} />
					<Status workSession={workSession} />
					<Decorations workSession={workSession} slot="row" interactive />
					<Menu workSession={workSession} label={`Actions for ${workSession.title}`} />
				</li>
			))}
		</ul>
	);
}

const boardPlugin = {
	manifest: testManifest("test.board", {
		contributes: {
			extensions: {
				"kilo.work-sessions/work-sessions-view": [{ id: "board", title: "Board" }],
				"kilo.work-sessions/work-session-decoration": [{ id: "badge", slot: "row" }],
			},
		},
	}),
	web: definePlugin({
		activate(sdk: PluginSdk) {
			sdk.extensions.implement(WorkSessionsView, "board", { component: Board });
			sdk.extensions.implement(
				WorkSessionDecoration,
				"badge",
				({ workSession, interactive }: WorkSessionDecorationProps) => (
					<span data-qa-id={`badge-${workSession.id}`}>{interactive ? "link" : "text"}</span>
				),
			);
		},
	}),
};

const card = (id: string) => page.getByTestId(`card-${id}`);

async function renderBoard(options: Parameters<typeof renderWorkSessions>[0] = {}) {
	const host = await renderWorkSessions({ guests: [boardPlugin], ...options });
	await host.window().methods.showView({ view: VIEW });
	await expect.element(page.getByTestId("board")).toBeVisible();
	return host;
}

describe("the work session renderers handed to work sessions views", () => {
	it("draw a work session's live status, glyph and decorations as the list does", async () => {
		await renderBoard({
			workSessions: [
				workSession("busy", { title: "Busy", chatIds: ["c1"] }),
				workSession("idle", { title: "Idle" }),
				workSession("old", { title: "Old", archived: true }),
			],
			chats: [chat("c1", { status: "busy", workingSince: NOW })],
		});

		await expect
			.element(card("busy").getByTestId("session-status"))
			.toHaveAttribute("data-status", "working");
		await expect.element(card("busy").getByRole("status", { name: "Working" })).toBeVisible();
		await expect
			.element(card("idle").getByTestId("session-status"))
			.toHaveAttribute("data-status", "idle");
		await expect
			.element(card("old").getByTestId("session-status"))
			.toHaveAttribute("data-status", "archived");
		await expect.element(card("idle").getByTestId("badge-idle")).toHaveTextContent("link");
	});

	it("give each card the work session's menu: pin, archive and delete", async () => {
		const { workSessions } = await renderBoard({
			workSessions: [workSession("a", { title: "Fix login" })],
		});
		const openMenu = () => card("a").getByRole("button", { name: "Actions for Fix login" }).click();

		await openMenu();
		await page.getByTestId("session-menu-pin").click();
		await vi.waitFor(() => expect(workSessions.calls.setPinned).toHaveBeenCalledWith("a", true));

		await openMenu();
		await page.getByTestId("session-menu-archive").click();
		await vi.waitFor(() => expect(workSessions.calls.setArchived).toHaveBeenCalledWith("a", true));

		await openMenu();
		await page.getByTestId("session-menu-delete").click();
		await page.getByTestId("session-delete-confirm").click();
		await vi.waitFor(() => expect(workSessions.calls.remove).toHaveBeenCalledWith("a"));
	});

	it("offer to remove the copy of its last work session from the menu", async () => {
		const { workSessions } = await renderBoard({
			workSessions: [
				workSession("a", {
					title: "Fix login",
					directory: "/projects/app/.kilo/worktrees/fix",
					branch: "kilo/fix",
				}),
			],
		});

		await card("a").getByRole("button", { name: "Actions for Fix login" }).click();
		await page.getByTestId("session-menu-delete").click();
		await page.getByTestId("session-delete-worktree-confirm").click();

		await vi.waitFor(() => expect(workSessions.calls.removeCopy).toHaveBeenCalledWith("a"));
	});
});
