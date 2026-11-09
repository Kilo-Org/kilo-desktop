import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { KernelWindowView } from "@kilo-desktop/kernel";
import { KernelProvider, RenderContribution } from "@kilo-desktop/kernel/web";
import { chat, NOW, session, workspace } from "@kilo-desktop/plugin-workbench/testing";

import { renderBoard } from "../test/board-host";
import { COLUMN_DRAG_FORMAT } from "./BoardColumnHeader";

const list = () => page.getByTestId("kilo-thread-list");
const row = (title: string) =>
	list()
		.getByTestId(/^session-list-(archived-)?item$/)
		.filter({ hasText: title });
const toggle = () => page.getByTestId("session-list-board");
const column = (id: string) => page.getByTestId(`workspace-board-column-${id}`);
const card = (id: string) => page.getByTestId(`workspace-board-card-${id}`);

async function openRowMenu(title: string) {
	await row(title).hover();
	await row(title).getByTestId("session-list-item-more").click();
}

/** Native drag events sharing one DataTransfer, as in a real drag. */
function drag(
	element: Element,
	type: string,
	dataTransfer: DataTransfer,
	point: { clientX?: number; clientY?: number } = {},
) {
	act(() => {
		element.dispatchEvent(
			new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true, ...point }),
		);
	});
}

/** Drags `source` and drops it on `target`, at the top or the bottom of the target. */
function dragOnto(source: Element, target: Element, at: "top" | "bottom" = "bottom") {
	const dataTransfer = new DataTransfer();
	const rect = target.getBoundingClientRect();
	const point = {
		clientX: rect.left + rect.width / 2,
		clientY: at === "top" ? rect.top + 1 : rect.bottom - 1,
	};
	drag(source, "dragstart", dataTransfer);
	drag(target, "dragenter", dataTransfer, point);
	drag(target, "dragover", dataTransfer, point);
	return {
		dataTransfer,
		drop: () => drag(target, "drop", dataTransfer, point),
	};
}

const Above = ({ children }: { readonly children: ReactNode }) => (
	<div style={{ position: "fixed", inset: 0, zIndex: 40, background: "white" }}>{children}</div>
);

describe("the workspace board", () => {
	it("stays out of the app while its flag is off", async () => {
		const { host } = await renderBoard({
			flag: false,
			sessions: [session("a", { title: "Fix login" })],
		});
		await expect.element(row("Fix login")).toBeVisible();
		expect(toggle().elements()).toHaveLength(0);
		await openRowMenu("Fix login");
		await expect.element(page.getByTestId("session-menu-delete")).toBeVisible();
		expect(page.getByText("Add to board").elements()).toHaveLength(0);
		await expect(host.renderer.commands.execute("kilo.workspace-board/open")).rejects.toMatchObject(
			{
				code: "NOT_FOUND",
			},
		);
	});

	it("toggles from the session list's header in place of the open session", async () => {
		const { navigator, tracked } = await renderBoard({
			sessions: [session("a", { title: "Fix login" })],
		});

		await toggle().click();
		await expect.element(page.getByTestId("workspace-board")).toBeVisible();
		await expect.element(toggle()).toHaveAttribute("aria-pressed", "true");
		await expect
			.element(page.getByTestId("sessions-view-title").getByText("Workspace Board"))
			.toBeVisible();
		for (const id of ["backlog", "in-progress", "review", "done"]) {
			await expect.element(column(id)).toBeVisible();
		}
		expect(tracked).toHaveBeenCalledWith("Workspace Board Opened", { source: "toggle" });

		await toggle().click();
		await vi.waitFor(() => expect(navigator().getState().view).toBeNull());
		await expect.element(toggle()).toHaveAttribute("aria-pressed", "false");
	});

	it("shows a card as the session list shows the session, filtered by the workspace focus", async () => {
		const { board, navigator } = await renderBoard({
			sessions: [
				session("a", { title: "Busy", chatIds: ["c1"], workspaceId: "w1" }),
				session("b", { title: "Elsewhere", workspaceId: "w2" }),
				session("c", { title: "Loose" }),
			],
			workspaces: [workspace("w1", "App"), workspace("w2", "Docs")],
			chats: [chat("c1", { status: "busy", workingSince: NOW - 1_000 })],
			focus: "w1",
			decorations: true,
		});
		for (const id of ["a", "b", "c", "gone"]) {
			await board().methods.place({ sessionId: id, columnId: "backlog", index: 9 });
		}
		await navigator().methods.showView({ view: "kilo.workspace-board/board" });

		await expect.element(card("a").getByTestId("session-status")).toHaveTextContent("Working");
		await expect.element(card("a").getByRole("button", { name: "Open Busy in App" })).toBeVisible();
		await expect.element(card("a").getByTestId("badge-a")).toBeVisible();
		// Outside the card's open button, so a badge may be a link (git's opens the PR).
		await expect
			.element(card("a").getByTestId("badge-a"))
			.toHaveAttribute("data-interactive", "true");
		await expect
			.element(page.getByTestId("workspace-board-column-count-backlog"))
			.toHaveTextContent("1");
		expect(card("b").elements()).toHaveLength(0);
		await expect.element(page.getByTestId("sessions-view-title").getByText("App")).toBeVisible();

		await navigator().methods.setFocus({ focus: "unscoped" });
		await expect.element(card("c").getByTestId("session-status")).toHaveTextContent("Idle");
		expect(card("a").elements()).toHaveLength(0);

		await navigator().methods.setFocus({ focus: null });
		await expect.element(card("b")).toBeVisible();
		await card("b").getByTestId("workspace-board-card-open").click();
		await vi.waitFor(() =>
			expect(navigator().getState()).toMatchObject({ activeSessionId: "b", view: null }),
		);
	});

	it("adds, moves and removes a session from its menu", async () => {
		const { cards, tracked } = await renderBoard({
			sessions: [session("a", { title: "Fix login" })],
		});

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-kilo.workspace-board/add-to-board").hover();
		await page.getByTestId("session-menu-kilo.workspace-board/add-to-board-review").click();
		await vi.waitFor(() => expect(cards().review).toEqual(["a"]));
		expect(tracked).toHaveBeenCalledWith("Workspace Board Session Placed", { source: "menu" });

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-kilo.workspace-board/move-on-board").hover();
		expect(
			page.getByTestId("session-menu-kilo.workspace-board/add-to-board").elements(),
		).toHaveLength(0);
		await expect
			.element(page.getByTestId("session-menu-kilo.workspace-board/move-on-board-review"))
			.toHaveAttribute("aria-checked", "true");
		await page.getByTestId("session-menu-kilo.workspace-board/move-on-board-done").click();
		await vi.waitFor(() => expect(cards()).toMatchObject({ review: [], done: ["a"] }));

		await openRowMenu("Fix login");
		await page.getByTestId("session-menu-kilo.workspace-board/remove-from-board").click();
		await vi.waitFor(() => expect(cards().done).toEqual([]));
	});

	it("offers the session menu on a card, renaming the session in place", async () => {
		const { board, navigator, sessions } = await renderBoard({
			sessions: [session("a", { title: "Fix login" })],
		});
		await board().methods.place({ sessionId: "a", columnId: "backlog", index: 0 });
		await navigator().methods.showView({ view: "kilo.workspace-board/board" });

		await card("a").hover();
		await card("a").getByRole("button", { name: "Session actions for Fix login" }).click();
		await page.getByTestId("session-menu-pin").click();
		await vi.waitFor(() => expect(sessions.calls.setPinned).toHaveBeenCalledWith("a", true));

		await card("a").hover();
		await card("a").getByRole("button", { name: "Session actions for Fix login" }).click();
		await page.getByTestId("session-menu-rename").click();
		await userEvent.fill(page.getByTestId("workspace-board-card-rename"), "Fix logout");
		await userEvent.keyboard("{Enter}");
		await vi.waitFor(() => expect(sessions.calls.rename).toHaveBeenCalledWith("a", "Fix logout"));
		await expect
			.element(card("a").getByTestId("workspace-board-card-title"))
			.toHaveTextContent("Fix logout");

		await card("a").hover();
		await card("a").getByRole("button", { name: "Session actions for Fix logout" }).click();
		await page.getByTestId("session-menu-rename").click();
		await userEvent.keyboard("{Escape}");
		await expect.element(card("a").getByTestId("workspace-board-card-title")).toBeVisible();
	});

	it("takes a session list row dropped on a column, previewing where it lands", async () => {
		const { cards, navigator, tracked } = await renderBoard({
			sessions: [session("a", { title: "Fix login" })],
		});
		await navigator().methods.showView({ view: "kilo.workspace-board/board" });
		await expect.element(column("review")).toBeVisible();

		const dragged = dragOnto(row("Fix login").element(), column("review").element());
		await expect
			.element(column("review").getByTestId("workspace-board-drop-preview"))
			.toBeVisible();
		await expect.element(column("review")).toHaveAttribute("data-drop-active", "true");
		dragged.drop();

		await vi.waitFor(() => expect(cards().review).toEqual(["a"]));
		await expect.element(column("review").getByTestId("workspace-board-card-a")).toBeVisible();
		expect(column("review").getByTestId("workspace-board-drop-preview").elements()).toHaveLength(0);
		expect(tracked).toHaveBeenCalledWith("Workspace Board Session Placed", { source: "drag" });
	});

	it("moves cards between columns and reorders them at the pointer", async () => {
		const { board, cards, navigator } = await renderBoard({
			sessions: [session("a"), session("b"), session("c")],
		});
		for (const id of ["a", "b"]) {
			await board().methods.place({ sessionId: id, columnId: "backlog", index: 9 });
		}
		await board().methods.place({ sessionId: "c", columnId: "review", index: 0 });
		await navigator().methods.showView({ view: "kilo.workspace-board/board" });
		await expect.element(card("b")).toBeVisible();

		dragOnto(card("b").element(), card("a").element(), "top").drop();
		await vi.waitFor(() => expect(cards().backlog).toEqual(["b", "a"]));

		dragOnto(card("a").element(), card("c").element(), "bottom").drop();
		await vi.waitFor(() => expect(cards()).toMatchObject({ backlog: ["b"], review: ["c", "a"] }));
	});

	it("adds, names, renames, moves and deletes columns", async () => {
		const { board, columns } = await renderBoardColumns();
		await page.getByTestId("workspace-board-add-column").click();
		const rename = page.getByTestId("workspace-board-column-rename");
		await expect.element(rename).toHaveValue("New column");
		await userEvent.fill(rename, "Later");
		await userEvent.keyboard("{Enter}");
		await vi.waitFor(() => expect(columns().at(-1)?.label).toBe("Later"));

		await openColumnMenu("done");
		await page.getByTestId("workspace-board-column-move-left").click();
		await vi.waitFor(() => expect(columns()[2]?.id).toBe("done"));

		await openColumnMenu("done");
		await page.getByTestId("workspace-board-column-rename-action").click();
		await userEvent.fill(rename, "Shipped");
		await userEvent.keyboard("{Enter}");
		await vi.waitFor(() => expect(columns()[2]?.label).toBe("Shipped"));

		await board().methods.place({ sessionId: "a", columnId: "done", index: 0 });
		await openColumnMenu("done");
		await page.getByTestId("workspace-board-column-delete-action").click();
		await expect
			.element(
				page
					.getByTestId("workspace-board-column-delete-dialog")
					.getByText(/moves its session to “Review”/),
			)
			.toBeVisible();
		await page.getByTestId("workspace-board-column-delete-confirm").click();
		await vi.waitFor(() => expect(columns().map((c) => c.id)).not.toContain("done"));
		expect(columns().find((c) => c.id === "review")?.sessionIds).toEqual(["a"]);

		await openColumnMenu("backlog");
		await page.getByTestId("workspace-board-column-delete-action").click();
		await vi.waitFor(() => expect(columns()[0]?.id).toBe("in-progress"));
	});

	it("reorders columns by dragging their headers", async () => {
		const { columns } = await renderBoardColumns();
		const header = page.getByTestId("workspace-board-column-header-backlog").element();
		const strip = page.getByTestId("workspace-board").element().firstElementChild!;
		const done = column("done").element().getBoundingClientRect();
		const dataTransfer = new DataTransfer();
		const point = { clientX: done.right - 2, clientY: done.top + 5 };

		drag(header, "dragstart", dataTransfer);
		expect(dataTransfer.getData(COLUMN_DRAG_FORMAT)).toBe("backlog");
		drag(strip, "dragover", dataTransfer, point);
		await expect.element(page.getByTestId("workspace-board-column-drop-preview")).toBeVisible();
		drag(strip, "drop", dataTransfer, point);

		await vi.waitFor(() =>
			expect(columns().map((c) => c.id)).toEqual(["in-progress", "review", "done", "backlog"]),
		);
		expect(page.getByTestId("workspace-board-column-drop-preview").elements()).toHaveLength(0);
	});

	it("clears the board after confirming, keeping columns", async () => {
		const { board, cards, tracked, runBoard } = await renderBoardColumns();
		await expect.element(page.getByTestId("workspace-board-clear")).toBeDisabled();
		await runBoard("clear");
		expect(page.getByTestId("workspace-board-clear-dialog").elements()).toHaveLength(0);

		await board().methods.place({ sessionId: "a", columnId: "review", index: 0 });
		await page.getByTestId("workspace-board-clear").click();
		await expect
			.element(
				page
					.getByTestId("workspace-board-clear-dialog")
					.getByText(/takes the session off the board/),
			)
			.toBeVisible();
		await page.getByTestId("workspace-board-clear-confirm").click();

		await vi.waitFor(() => expect(cards().review).toEqual([]));
		expect(tracked).toHaveBeenCalledWith("Workspace Board Cleared", { cards: 1 });
	});

	it("opens the board, adds a column and clears it from commands", async () => {
		const { board, navigator, runBoard } = await renderBoard({ sessions: [session("a")] });

		await runBoard("add-column");
		await vi.waitFor(() => expect(navigator().getState().view).toBe("kilo.workspace-board/board"));
		await expect.element(page.getByTestId("workspace-board-column-rename")).toBeVisible();
		await vi.waitFor(() => expect(board().getState().board.columns).toHaveLength(5));
		await userEvent.keyboard("{Escape}");

		await board().methods.place({ sessionId: "a", columnId: "review", index: 0 });
		await runBoard("open");
		await vi.waitFor(() => expect(navigator().getState().view).toBeNull());
		await runBoard("clear");
		await expect.element(page.getByTestId("workspace-board-clear-dialog")).toBeVisible();
	});

	it("pops out and shows in its own window, opening sessions in the main window", async () => {
		const windows = {
			open: vi.fn(async () => "w9"),
			focus: vi.fn(),
			close: vi.fn(),
			setHidden: vi.fn(),
			focusMain: vi.fn(),
		};
		const { board, host, navigator } = await renderBoard({
			sessions: [session("a", { title: "Fix login" })],
			windows,
		});
		await board().methods.place({ sessionId: "a", columnId: "backlog", index: 0 });
		await navigator().methods.showView({ view: "kilo.workspace-board/board" });

		await page.getByTestId("sessions-view-pop-out").click();
		await vi.waitFor(() =>
			expect(windows.open).toHaveBeenCalledWith(
				expect.objectContaining({
					params: { view: "kilo.workspace-board/board" },
					width: expect.any(Number),
				}),
			),
		);

		const windowView = host.renderer.extensions
			.list(KernelWindowView)
			.find((contribution) => contribution.key === "kilo.workbench/sessions-view-window")!;
		render(
			<KernelProvider kernel={host.renderer}>
				<Above>
					<RenderContribution
						contribution={windowView}
						props={{ params: { view: "kilo.workspace-board/board" } }}
					/>
				</Above>
			</KernelProvider>,
		);
		const detached = page.getByTestId("sessions-view-window");
		await expect.element(detached.getByTestId("workspace-board-card-a")).toBeVisible();
		await detached.getByTestId("workspace-board-clear").click();
		// The main window's overlay and the board's own window each mount one.
		await expect.element(page.getByTestId("workspace-board-clear-dialog").first()).toBeVisible();
		await userEvent.keyboard("{Escape}");

		await detached.getByTestId("workspace-board-card-open").click();
		await vi.waitFor(() => expect(navigator().getState().activeSessionId).toBe("a"));
		expect(windows.focusMain).toHaveBeenCalled();
	});

	it("moves and removes a card from its menu in the board's own window", async () => {
		const { board, cards, host } = await renderBoard({
			sessions: [session("a", { title: "Fix login" })],
		});
		await board().methods.place({ sessionId: "a", columnId: "backlog", index: 0 });
		const params = { view: "kilo.workspace-board/board" };
		const popOut = await host.openWindow("w9", {
			role: "secondary",
			view: "kilo.workbench/sessions-view-window",
			params,
		});
		const windowView = popOut.extensions
			.list(KernelWindowView)
			.find((contribution) => contribution.key === "kilo.workbench/sessions-view-window")!;
		render(
			<KernelProvider kernel={popOut}>
				<Above>
					<RenderContribution contribution={windowView} props={{ params }} />
				</Above>
			</KernelProvider>,
		);
		const detached = page.getByTestId("sessions-view-window");
		const openCardMenu = async () => {
			await detached.getByTestId("workspace-board-card-a").hover();
			await detached.getByRole("button", { name: "Session actions for Fix login" }).click();
		};

		await openCardMenu();
		await page.getByTestId("session-menu-kilo.workspace-board/move-on-board").hover();
		await page.getByTestId("session-menu-kilo.workspace-board/move-on-board-review").click();
		await vi.waitFor(() => expect(cards()).toMatchObject({ backlog: [], review: ["a"] }));

		await openCardMenu();
		await page.getByTestId("session-menu-kilo.workspace-board/remove-from-board").click();
		await vi.waitFor(() => expect(cards().review).toEqual([]));
	});
});

/** The menu shows while the column's header, not one of its cards, is hovered. */
async function openColumnMenu(columnId: string) {
	await page.getByTestId(`workspace-board-column-header-${columnId}`).hover();
	await page.getByTestId(`workspace-board-column-menu-${columnId}`).click();
}

async function renderBoardColumns() {
	const host = await renderBoard({ sessions: [session("a")] });
	await host.navigator().methods.showView({ view: "kilo.workspace-board/board" });
	await expect.element(column("done")).toBeVisible();
	const columns = () => host.board().getState().board.columns;
	return { ...host, columns };
}
