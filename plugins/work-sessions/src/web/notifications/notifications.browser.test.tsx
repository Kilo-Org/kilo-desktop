import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { MainKernel } from "@kilo-desktop/kernel/main";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

import { PermissionAutoAnswer } from "../../contracts";
import {
	chat,
	fakeNotifications,
	NOW,
	paneKindPlugin,
	renderWorkSessions,
	workSession,
} from "../../testing";
import {
	NOTIFICATION_PREFERENCES_STORAGE_KEY,
	ORIGIN_NOTIFICATION_PREFERENCES_STORAGE_KEY,
} from "./notification-preferences";

const row = (title: string) =>
	page.getByTestId("kilo-thread-list").getByTestId("session-list-item").filter({ hasText: title });
const glyph = (title: string, label: string) => row(title).getByRole("status", { name: label });

describe("chat notifications", () => {
	function background(main: MainKernel) {
		main.windowEvents.opened("main", { role: "main" });
		return fakeNotifications(main);
	}

	it("shows a system notification while Kilo is in the background, and not while it is focused", async () => {
		let shown: ReturnType<typeof fakeNotifications> | undefined;
		let main: MainKernel | undefined;
		const { chats } = await renderWorkSessions({
			workSessions: [workSession("s1", { title: "Fix login", chatIds: ["c1"] })],
			chats: [chat("c1", { status: "busy", workingSince: NOW })],
			beforeRender: (kernel) => {
				main = kernel;
				shown = background(kernel);
			},
		});
		await expect.element(glyph("Fix login", "Working")).toBeVisible();

		chats!.update(chat("c1", { completedAt: Date.now() }));
		chats!.events.emit("turn-ended", { chatId: "c1" });
		chats!.events.emit("turn-ended", { chatId: "c1" });
		chats!.events.emit("turn-ended", { chatId: "c1" });
		chats!.events.emit("work-completed", { chatId: "c1" });
		await vi.waitFor(() =>
			expect(shown).toHaveBeenCalledWith({
				title: "Kilo finished",
				body: "Open Kilo to continue.",
				silent: true,
			}),
		);

		main!.windowEvents.focused("main");
		chats!.events.emit("permission-requested", { chatId: "c1", permissionId: "p1" });
		chats!.events.emit("turn-ended", {
			chatId: "c1",
			error: { name: "ApiError", message: "x" },
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(shown).toHaveBeenCalledTimes(1);
	});

	it("stays quiet when notifications are off", async () => {
		let shown: ReturnType<typeof fakeNotifications> | undefined;
		const { chats } = await renderWorkSessions({
			workSessions: [workSession("s1", { chatIds: ["c1"] })],
			chats: [chat("c1")],
			localStorage: {
				[NOTIFICATION_PREFERENCES_STORAGE_KEY]: JSON.stringify({ done: "off", needsYou: "off" }),
			},
			beforeRender: (kernel) => {
				shown = background(kernel);
			},
		});
		await expect.element(row("Session s1")).toBeVisible();

		chats!.events.emit("work-completed", { chatId: "c1" });
		chats!.events.emit("question-requested", { chatId: "c1", questionId: "q" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(shown).not.toHaveBeenCalled();
	});

	it("stays quiet for a permission request another plugin answers for the person", async () => {
		let shown: ReturnType<typeof fakeNotifications> | undefined;
		const autoApprover = paneKindPlugin("test.auto-approver", [], {
			extensions: { "kilo.work-sessions/permission-auto-answer": [{ id: "auto" }] },
			activate: (sdk) =>
				sdk.extensions.implement(
					PermissionAutoAnswer,
					"auto",
					(request) => request.permission === "external_directory",
				),
		});
		const { chats } = await renderWorkSessions({
			workSessions: [workSession("s1", { chatIds: ["c1"] })],
			chats: [chat("c1", { status: "busy", workingSince: NOW })],
			guests: [autoApprover],
			beforeRender: (kernel) => {
				shown = background(kernel);
			},
		});
		await expect.element(row("Session s1")).toBeVisible();
		const request = (id: string, permission: string) => ({
			id,
			chatId: "c1",
			permission,
			patterns: ["*"],
			metadata: {},
		});
		chats!.setPermissionRequests([request("read", "external_directory"), request("rm", "bash")]);

		chats!.events.emit("permission-requested", { chatId: "c1", permissionId: "read" });
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(shown).not.toHaveBeenCalled();

		chats!.events.emit("permission-requested", { chatId: "c1", permissionId: "rm" });
		await vi.waitFor(() =>
			expect(shown).toHaveBeenCalledWith({
				title: "Kilo needs your approval",
				body: "Open Kilo to continue.",
				silent: true,
			}),
		);
		expect(shown).toHaveBeenCalledTimes(1);
	});
});

describe("Notifications settings", () => {
	const modeSelect = (name: string) => page.getByRole("combobox", { name });
	const selectedLabel = (name: string) => () => modeSelect(name).element().textContent ?? "";

	it("adopts origin's modes, sets each cue on its own and saves it", async () => {
		const { host } = await renderWorkSessions({
			localStorage: {
				[ORIGIN_NOTIFICATION_PREFERENCES_STORAGE_KEY]: JSON.stringify({
					state: { done: "always", needsYou: "smart" },
					version: 0,
				}),
			},
		});
		await host.renderer.kernelSdk.domainObjects
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
