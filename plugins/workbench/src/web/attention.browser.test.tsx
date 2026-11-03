import { describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import type { MainKernel } from "@kilo-desktop/kernel/main";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

import { chat, fakeNotifications, NOW, renderWorkbench, session } from "../test/fakes";
import {
	LAST_VISITED_STORAGE_KEY,
	ORIGIN_LAST_VISITED_STORAGE_KEY,
} from "./attention/last-visited";
import {
	NOTIFICATION_PREFERENCES_STORAGE_KEY,
	ORIGIN_NOTIFICATION_PREFERENCES_STORAGE_KEY,
} from "./notifications/notification-preferences";

const list = () => page.getByTestId("kilo-thread-list");
const row = (title: string) => list().getByTestId("session-list-item").filter({ hasText: title });
const glyph = (title: string, label: string) => row(title).getByRole("status", { name: label });
const visits = (sessions: Record<string, number>) => ({
	[LAST_VISITED_STORAGE_KEY]: JSON.stringify({ sessions, originChats: {} }),
});

describe("live session status", () => {
	it("shows working, approval, input and unread from the sessions' chats and their subagents", async () => {
		await renderWorkbench({
			sessions: [
				session("s-work", { title: "Working one", chatIds: ["c-work"] }),
				session("s-approve", { title: "Approval one", chatIds: ["c-approve"] }),
				session("s-input", { title: "Input one", chatIds: ["c-input"] }),
				session("s-done", { title: "Done one", chatIds: ["c-done"] }),
				session("s-seen", { title: "Seen one", chatIds: ["c-seen"] }),
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
		await renderWorkbench({
			sessions: [
				session("s-work", { title: "Working one", chatIds: ["c-work"] }),
				session("s-idle", { title: "Idle one", chatIds: ["c-idle"] }),
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
		const { conversations } = await renderWorkbench({
			sessions: [session("s1", { title: "Fix login", chatIds: ["c1"] })],
			chats: [chat("c1")],
			localStorage: visits({ s1: NOW - 5_000 }),
		});
		await expect.element(row("Fix login")).toBeVisible();

		conversations!.update(chat("c1", { status: "busy", workingSince: Date.now() }));
		await expect.element(glyph("Fix login", "Working")).toBeVisible();

		conversations!.update(
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
		await renderWorkbench({
			sessions: [session("s1", { title: "Fix login", chatIds: ["c1"] })],
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
		const { conversations, host } = await renderWorkbench({
			sessions: [session("s1", { title: "Fix login", chatIds: ["c1"] })],
			chats: [chat("c1", { status: "busy", workingSince: NOW })],
		});
		await row("Fix login").getByTestId("session-list-item-trigger").click();

		conversations!.update(chat("c1", { completedAt: Date.now() + 1_000 }));
		await expect.element(glyph("Fix login", "Working")).not.toBeInTheDocument();
		await expect.element(row("Fix login").getByRole("status")).not.toBeInTheDocument();

		const visitedAt = () =>
			JSON.parse(localStorage.getItem(LAST_VISITED_STORAGE_KEY) ?? "{}").sessions.s1 as number;
		const watched = visitedAt();

		await host.renderer.kernelSdk.domains
			.get(Navigation)!
			.methods.openSettings({ section: "appearance" });
		await vi.waitFor(() =>
			expect(host.renderer.kernelSdk.domains.get(Navigation)!.getState().path).toBe(
				"/settings/appearance",
			),
		);
		conversations!.update(chat("c1", { completedAt: watched + 5_000 }));
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(visitedAt()).toBe(watched);
	});
});

describe("next session that needs attention", () => {
	it("moves down through sessions waiting on you, wrapping to the top", async () => {
		const { run, navigator } = await renderWorkbench({
			sessions: [
				session("a", { title: "First", chatIds: ["ca"], updatedAt: NOW - 1_000 }),
				session("b", { title: "Second", chatIds: ["cb"], updatedAt: NOW - 2_000 }),
				session("c", { title: "Third", chatIds: ["cc"], updatedAt: NOW - 3_000 }),
			],
			chats: [
				chat("ca", { pendingQuestionIds: ["q"] }),
				chat("cb"),
				chat("cc", { pendingPermissionIds: ["p"] }),
			],
			localStorage: { "kilo-ui.session-list-view:v1": JSON.stringify({ grouping: "updated" }) },
		});
		await expect.element(row("First")).toBeVisible();
		const active = () => navigator().getState().activeSessionId;

		await run("next-attention-session");
		await vi.waitFor(() => expect(active()).toBe("a"));
		await run("next-attention-session");
		await vi.waitFor(() => expect(active()).toBe("c"));
		await run("next-attention-session");
		await vi.waitFor(() => expect(active()).toBe("a"));
	});
});

describe("chat notifications", () => {
	function background(main: MainKernel) {
		main.windowEvents.opened("main", { role: "main" });
		return fakeNotifications(main);
	}

	it("shows a system notification while Kilo is in the background, and not while it is focused", async () => {
		let shown: ReturnType<typeof fakeNotifications> | undefined;
		let main: MainKernel | undefined;
		const { conversations } = await renderWorkbench({
			sessions: [session("s1", { title: "Fix login", chatIds: ["c1"] })],
			chats: [chat("c1", { status: "busy", workingSince: NOW })],
			beforeRender: (kernel) => {
				main = kernel;
				shown = background(kernel);
			},
		});
		await expect.element(glyph("Fix login", "Working")).toBeVisible();

		conversations!.update(chat("c1", { completedAt: Date.now() }));
		conversations!.events.emit("turn-ended", { chatId: "c1" });
		await vi.waitFor(() =>
			expect(shown).toHaveBeenCalledWith({
				title: "Kilo finished",
				body: "Open Kilo to continue.",
				silent: true,
			}),
		);

		main!.windowEvents.focused("main");
		conversations!.events.emit("permission-requested", { chatId: "c1", permissionId: "p1" });
		conversations!.events.emit("turn-ended", {
			chatId: "c1",
			error: { name: "ApiError", message: "x" },
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(shown).toHaveBeenCalledTimes(1);
	});

	it("stays quiet when notifications are off", async () => {
		let shown: ReturnType<typeof fakeNotifications> | undefined;
		const { conversations } = await renderWorkbench({
			sessions: [session("s1", { chatIds: ["c1"] })],
			chats: [chat("c1")],
			localStorage: {
				[NOTIFICATION_PREFERENCES_STORAGE_KEY]: JSON.stringify({ done: "off", needsYou: "off" }),
			},
			beforeRender: (kernel) => {
				shown = background(kernel);
			},
		});
		await expect.element(row("Session s1")).toBeVisible();

		conversations!.events.emit("turn-ended", { chatId: "c1" });
		conversations!.events.emit("question-requested", { chatId: "c1", questionId: "q" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(shown).not.toHaveBeenCalled();
	});
});

describe("Notifications settings", () => {
	const modeSelect = (name: string) => page.getByRole("combobox", { name });
	const selectedLabel = (name: string) => () => modeSelect(name).element().textContent ?? "";

	it("adopts origin's modes, sets each cue on its own and saves it", async () => {
		const { host } = await renderWorkbench({
			localStorage: {
				[ORIGIN_NOTIFICATION_PREFERENCES_STORAGE_KEY]: JSON.stringify({
					state: { done: "always", needsYou: "smart" },
					version: 0,
				}),
			},
		});
		await host.renderer.kernelSdk.domains
			.get(Navigation)!
			.methods.openSettings({ section: "notifications" });

		await expect.element(page.getByTestId("notification-settings")).toBeVisible();
		await expect.poll(selectedLabel("When Kilo finishes")).toContain("Always");
		await expect.poll(selectedLabel("When Kilo needs you")).toContain("When I'm not looking");

		await modeSelect("When Kilo finishes").click();
		await page.getByRole("option", { name: "Never" }).click();
		await modeSelect("When Kilo needs you").click();
		await page.getByRole("option", { name: "Always" }).click();

		await expect.poll(selectedLabel("When Kilo finishes")).toContain("Never");
		await expect.poll(selectedLabel("When Kilo needs you")).toContain("Always");
		expect(JSON.parse(localStorage.getItem(NOTIFICATION_PREFERENCES_STORAGE_KEY) ?? "{}")).toEqual({
			done: "off",
			needsYou: "always",
		});
		await page.getByTestId("notification-preview-done").click();
	});
});

describe("shortcut number chips", () => {
	it("number the sessions while the go-to-session modifier is held", async () => {
		await renderWorkbench({
			sessions: [
				session("a", { title: "Newer", updatedAt: NOW - 1_000 }),
				session("b", { title: "Older", updatedAt: NOW - 2_000 }),
			],
		});
		await expect.element(row("Newer")).toBeVisible();

		await userEvent.keyboard("{Control>}");
		await expect.element(row("Newer").getByText("⌃1")).toBeVisible();
		await expect.element(row("Older").getByText("⌃2")).toBeVisible();

		await userEvent.keyboard("{/Control}");
		await expect.element(row("Newer").getByText("⌃1")).not.toBeInTheDocument();
	});
});
