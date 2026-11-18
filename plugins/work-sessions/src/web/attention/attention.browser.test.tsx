import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

import { chat, NOW, renderWorkSessions, workSession } from "../../testing";
import { LAST_VISITED_STORAGE_KEY, ORIGIN_LAST_VISITED_STORAGE_KEY } from "./last-visited";

const list = () => page.getByTestId("kilo-thread-list");
const row = (title: string) => list().getByTestId("session-list-item").filter({ hasText: title });
const glyph = (title: string, label: string) => row(title).getByRole("status", { name: label });
const visits = (sessions: Record<string, number>) => ({
	[LAST_VISITED_STORAGE_KEY]: JSON.stringify({ sessions, originChats: {} }),
});

describe("live session status", () => {
	it("shows working, approval, input and unread from the sessions' chats and their subagents", async () => {
		await renderWorkSessions({
			workSessions: [
				workSession("s-work", { title: "Working one", chatIds: ["c-work"] }),
				workSession("s-approve", { title: "Approval one", chatIds: ["c-approve"] }),
				workSession("s-input", { title: "Input one", chatIds: ["c-input"] }),
				workSession("s-done", { title: "Done one", chatIds: ["c-done"] }),
				workSession("s-seen", { title: "Seen one", chatIds: ["c-seen"] }),
			],
			chats: [
				chat("c-work", { status: "busy", workingSince: NOW - 5_000 }),
				chat("c-approve", { status: "busy", workingSince: NOW - 5_000 }),
				chat("c-sub", { status: "busy", pendingPermissionIds: ["p1"] }, { parentId: "c-approve" }),
				chat("c-input", { pendingQuestionIds: ["q1"] }),
				chat("c-done", { completedAt: NOW - 1_000 }),
				chat("c-seen", { completedAt: NOW - 9_000 }),
			],
			localStorage: visits({ "s-done": NOW - 5_000, "s-seen": NOW - 5_000 }),
		});

		await expect.element(glyph("Working one", "Working")).toBeVisible();
		await expect.element(glyph("Approval one", "Requires approval")).toBeVisible();
		await expect.element(glyph("Input one", "Requires input")).toBeVisible();
		await expect.element(glyph("Done one", "Unread")).toBeVisible();
		await expect.element(row("Seen one").getByRole("status")).not.toBeInTheDocument();
		await expect.element(list().getByTestId("session-list-attention-toggle")).toBeVisible();
	});

	it("filters by live status", async () => {
		await renderWorkSessions({
			workSessions: [
				workSession("s-work", { title: "Working one", chatIds: ["c-work"] }),
				workSession("s-idle", { title: "Idle one", chatIds: ["c-idle"] }),
			],
			chats: [chat("c-work", { status: "retry", workingSince: NOW }), chat("c-idle")],
		});

		await page.getByTestId("session-list-view-menu").click();
		await page.getByRole("menuitem", { name: /^Status/ }).click();
		await page.getByRole("menuitemradio", { name: "Working" }).click();
		await userEvent.keyboard("{Escape}{Escape}");

		await expect.element(row("Working one")).toBeVisible();
		await expect.element(row("Idle one")).not.toBeInTheDocument();
	});

	it("follows chats as they change, and shows a failure on hover", async () => {
		const { chats } = await renderWorkSessions({
			workSessions: [workSession("s1", { title: "Fix login", chatIds: ["c1"] })],
			chats: [chat("c1")],
			localStorage: visits({ s1: NOW - 5_000 }),
		});
		await expect.element(row("Fix login")).toBeVisible();

		chats!.update(chat("c1", { status: "busy", workingSince: Date.now() }));
		await expect.element(glyph("Fix login", "Working")).toBeVisible();

		chats!.update(
			chat("c1", {
				completedAt: Date.now(),
				lastError: { name: "ApiError", message: "Rate limited" },
			}),
		);
		await expect.element(glyph("Fix login", "Unread")).toBeVisible();
		await row("Fix login").getByTestId("session-list-item-trigger").hover();
		await expect
			.element(page.getByTestId("session-list-item-error").getByText("Rate limited"))
			.toBeVisible();
	});
});

describe("unread", () => {
	it("clears when the session is opened, adopting origin's per-chat visits", async () => {
		await renderWorkSessions({
			workSessions: [workSession("s1", { title: "Fix login", chatIds: ["c1"] })],
			chats: [chat("c1", { completedAt: NOW - 1_000 })],
			localStorage: { [ORIGIN_LAST_VISITED_STORAGE_KEY]: JSON.stringify({ c1: NOW - 5_000 }) },
		});
		await expect.element(glyph("Fix login", "Unread")).toBeVisible();

		await row("Fix login").getByTestId("session-list-item-trigger").click();

		await expect.element(row("Fix login").getByRole("status")).not.toBeInTheDocument();
		const saved = JSON.parse(localStorage.getItem(LAST_VISITED_STORAGE_KEY) ?? "{}");
		expect(saved.sessions.s1).toBeGreaterThanOrEqual(NOW - 1_000);
	});

	it("keeps a session read when its turn ends while it is open, but not once you look away", async () => {
		const { chats, host } = await renderWorkSessions({
			workSessions: [workSession("s1", { title: "Fix login", chatIds: ["c1"] })],
			chats: [chat("c1", { status: "busy", workingSince: NOW })],
		});
		await row("Fix login").getByTestId("session-list-item-trigger").click();

		chats!.update(chat("c1", { completedAt: Date.now() + 1_000 }));
		await expect.element(glyph("Fix login", "Working")).not.toBeInTheDocument();
		await expect.element(row("Fix login").getByRole("status")).not.toBeInTheDocument();

		const visitedAt = () =>
			JSON.parse(localStorage.getItem(LAST_VISITED_STORAGE_KEY) ?? "{}").sessions.s1 as number;
		const watched = visitedAt();

		await host.renderer.kernelSdk.domainObjects
			.get(Navigation)!
			.methods.openSettings({ section: "appearance" });
		await vi.waitFor(() =>
			expect(
				host.renderer.kernelSdk.domainObjects.get(Navigation)!.getState().windows.main?.path,
			).toBe("/settings/appearance"),
		);
		chats!.update(chat("c1", { completedAt: watched + 5_000 }));
		expect(visitedAt()).toBe(watched);
	});
});

describe("next session that needs attention", () => {
	it("moves down through sessions waiting on you, wrapping to the top", async () => {
		const { run, window } = await renderWorkSessions({
			workSessions: [
				workSession("a", { title: "First", chatIds: ["ca"], updatedAt: NOW - 1_000 }),
				workSession("b", { title: "Second", chatIds: ["cb"], updatedAt: NOW - 2_000 }),
				workSession("c", { title: "Third", chatIds: ["cc"], updatedAt: NOW - 3_000 }),
			],
			chats: [
				chat("ca", { pendingQuestionIds: ["q"] }),
				chat("cb"),
				chat("cc", { pendingPermissionIds: ["p"] }),
			],
			localStorage: { "kilo-ui.session-list-view:v1": JSON.stringify({ grouping: "updated" }) },
		});
		await expect.element(row("First")).toBeVisible();
		const active = () => window().getState().activeWorkSessionId;

		await run("next-attention-work-session");
		await vi.waitFor(() => expect(active()).toBe("a"));
		await run("next-attention-work-session");
		await vi.waitFor(() => expect(active()).toBe("c"));
		await run("next-attention-work-session");
		await vi.waitFor(() => expect(active()).toBe("a"));
	});
});
