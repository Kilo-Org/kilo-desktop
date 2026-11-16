import { describe, expect, it } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";
import { ToolApproval } from "@kilo-desktop/plugin-core/contracts";

import { AutoApprove, needsPerson } from "../../contracts";
import { bootChatMain, chat, request, settle, signInToolPlugin } from "../test-boot";

async function boot(options: Parameters<typeof bootChatMain>[0] = {}) {
	const booted = await bootChatMain({ workSessions: null, ...options });
	return { ...booted, autoApprove: booted.chatSdk.domainObjects.get(AutoApprove)! };
}

const SIGN_IN_TOOL = "kilo.terminal/open_terminal";

describe("needsPerson", () => {
	it("flags prompts auto-approve never answers", () => {
		expect(needsPerson({ sandboxEscalation: true })).toBe(true);
		expect(needsPerson({ configProtected: true })).toBe(true);
		expect(needsPerson({ skillShell: true })).toBe(true);
		expect(needsPerson({ sandboxEscalation: "yes" })).toBe(false);
		expect(needsPerson({})).toBe(false);
	});
});

describe("auto mode", () => {
	it("answers a request once, holding it back until it resolves", async () => {
		const { core, autoApprove } = await boot({ chats: [chat("ses_a")] });
		await autoApprove.methods.setMode({ mode: "auto" });
		core.requests.set("ses_a", [request("per_1", "ses_a")]);

		core.ask("ses_a", "per_1");
		expect(autoApprove.getState().holding).toEqual(["per_1"]);
		await settle();

		expect(core.replies).toEqual([{ chatId: "ses_a", permissionId: "per_1", reply: "once" }]);
		// Still listed: a window may not have dropped the request yet, and would show its card.
		core.resolve("ses_a", "per_1");
		expect(autoApprove.getState().holding).toEqual(["per_1"]);

		core.requests.set("ses_a", [request("per_2", "ses_a")]);
		core.ask("ses_a", "per_2");
		expect(autoApprove.getState().holding).toEqual(["per_2"]);
	});

	it("shows the request when the reply fails, or after the reveal delay", async () => {
		const { core, autoApprove } = await boot({ chats: [chat("ses_a")], revealAfterMs: 20 });
		await autoApprove.methods.setMode({ mode: "auto" });
		core.requests.set("ses_a", [request("per_1", "ses_a"), request("per_2", "ses_a")]);

		core.failReplies = true;
		core.ask("ses_a", "per_1");
		await settle();
		expect(autoApprove.getState().holding).toEqual([]);

		core.failReplies = false;
		core.ask("ses_a", "per_2");
		core.ask("ses_a", "per_2");
		await settle();
		expect(autoApprove.getState().holding).toEqual(["per_2"]);
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(autoApprove.getState().holding).toEqual([]);
	});

	it("leaves sandbox escalation and protected config to a person, and answers skill-shell unheld", async () => {
		const { core, autoApprove } = await boot({ chats: [chat("ses_a")] });
		await autoApprove.methods.setMode({ mode: "auto" });
		core.requests.set("ses_a", [
			request("per_sandbox", "ses_a", { metadata: { sandboxEscalation: true } }),
			request("per_config", "ses_a", { metadata: { configProtected: true } }),
			request("per_skill", "ses_a", { metadata: { skillShell: true } }),
		]);

		core.ask("ses_a", "per_sandbox");
		core.ask("ses_a", "per_config");
		core.ask("ses_a", "per_skill");
		await settle();

		expect(core.replies.map((reply) => reply.permissionId)).toEqual(["per_skill"]);
		expect(autoApprove.getState().holding).toEqual([]);
	});

	it("shows a request it can't read or that is gone", async () => {
		const { core, autoApprove } = await boot({ chats: [chat("ses_a")] });
		await autoApprove.methods.setMode({ mode: "auto" });

		core.ask("ses_a", "per_gone");
		core.failReads = true;
		core.ask("ses_a", "per_unreadable");
		await settle();

		expect(core.replies).toEqual([]);
		expect(autoApprove.getState().holding).toEqual([]);
	});

	it("drains pending requests when Auto turns on and when the chat list becomes ready", async () => {
		const pending = (id: string, permissionId: string) =>
			chat(id, {
				activity: {
					status: "idle",
					pendingPermissionIds: [permissionId],
					pendingQuestionIds: [],
				},
			});
		const { core, autoApprove } = await boot({
			chats: [pending("ses_a", "per_1"), pending("ses_b", "per_2")],
			ready: false,
		});
		core.requests.set("ses_a", [request("per_1", "ses_a")]);
		core.requests.set("ses_b", [request("per_2", "ses_b")]);

		await autoApprove.methods.setMode({ mode: "auto" });
		await settle();
		expect(core.replies).toEqual([]);

		core.setReady(true);
		await settle();
		await settle();
		expect(core.replies.map((reply) => reply.permissionId)).toEqual(["per_1", "per_2"]);
	});

	it("stops a drain when switched back to manual", async () => {
		const { core, autoApprove } = await boot({
			chats: [
				chat("ses_a", {
					activity: {
						status: "idle",
						pendingPermissionIds: ["per_1", "per_2"],
						pendingQuestionIds: [],
					},
				}),
			],
		});
		core.requests.set("ses_a", [request("per_1", "ses_a"), request("per_2", "ses_a")]);

		await autoApprove.methods.setMode({ mode: "auto" });
		await autoApprove.methods.setMode({ mode: "manual" });
		await settle();
		await settle();

		expect(core.replies.length).toBeLessThanOrEqual(1);
	});

	it("does not answer a request it was reading when the person switched back to manual", async () => {
		const { core, autoApprove } = await boot({ chats: [chat("ses_a")], signedIn: true });
		await autoApprove.methods.setMode({ mode: "auto" });
		core.requests.set("ses_a", [request("per_1", "ses_a")]);
		let finishRead = () => {};
		core.readGate = new Promise<void>((resolve) => (finishRead = resolve));

		core.ask("ses_a", "per_1");
		await settle();
		await autoApprove.methods.setMode({ mode: "manual" });
		finishRead();
		await settle();
		await settle();

		expect(core.replies).toEqual([]);
		expect(autoApprove.getState().holding).toEqual([]);
	});

	it("shows what it held when kilo.core goes away", async () => {
		const { core, autoApprove, setCorePresent } = await boot({
			chats: [chat("ses_a")],
			removableCore: true,
		});
		await autoApprove.methods.setMode({ mode: "auto" });
		core.readGate = new Promise<void>(() => {});
		core.ask("ses_a", "per_1");
		expect(autoApprove.getState().holding).toEqual(["per_1"]);

		await setCorePresent(false);

		expect(autoApprove.getState().holding).toEqual([]);
	});
});

describe("manual mode", () => {
	it("answers a sign-in tool's request while signed out, so chat's sign-in prompt comes first", async () => {
		const { core, autoApprove } = await boot({
			chats: [chat("ses_a")],
			signedIn: false,
			plugins: [signInToolPlugin()],
		});
		core.requests.set("ses_a", [
			request("per_tool", "ses_a", {
				permission: "desktop_terminal_open_terminal",
				toolKey: SIGN_IN_TOOL,
			}),
			request("per_other_tool", "ses_a", {
				permission: "desktop_terminal_list_terminals",
				toolKey: "kilo.terminal/list_terminals",
			}),
			request("per_bash", "ses_a"),
		]);

		core.ask("ses_a", "per_tool");
		core.ask("ses_a", "per_other_tool");
		core.ask("ses_a", "per_bash");
		await settle();

		expect(core.replies.map((reply) => reply.permissionId)).toEqual(["per_tool"]);
		expect(autoApprove.getState().holding).toEqual(["per_tool"]);
	});

	it("leaves every request alone while signed in, or without sign-in tools", async () => {
		for (const options of [
			{ signedIn: true, plugins: [signInToolPlugin()] },
			{ signedIn: false, plugins: [] },
		]) {
			const { core, autoApprove } = await boot({ chats: [chat("ses_a")], ...options });
			core.requests.set("ses_a", [
				request("per_tool", "ses_a", { toolKey: SIGN_IN_TOOL, permission: "x" }),
			]);

			core.ask("ses_a", "per_tool");
			await settle();

			expect(core.replies).toEqual([]);
			expect(autoApprove.getState().holding).toEqual([]);
		}
	});

	it("leaves a sign-in tool's request that needs a person alone", async () => {
		const { core } = await boot({
			chats: [chat("ses_a")],
			signedIn: false,
			plugins: [signInToolPlugin()],
		});
		core.requests.set("ses_a", [
			request("per_tool", "ses_a", { toolKey: SIGN_IN_TOOL, metadata: { skillShell: true } }),
		]);

		core.ask("ses_a", "per_tool");
		await settle();

		expect(core.replies).toEqual([]);
	});
});

describe("the mode", () => {
	it("is kept across restarts, reading the previous kilo.chat's saved value", async () => {
		const storage = createMemoryStorage("/data/kilo.chat");
		storage.saved.set("auto-approve", { mode: "auto", importedFromOrigin: true });

		const first = await boot({ storage, withoutCore: true });
		expect(first.autoApprove.getState().mode).toBe("auto");
		await first.autoApprove.methods.setMode({ mode: "manual" });

		const restarted = await boot({ storage, withoutCore: true });
		expect(restarted.autoApprove.getState().mode).toBe("manual");
	});

	it("is changed only by kilo.chat and the kernel", async () => {
		const { autoApprove, as, kernel } = await boot();

		await autoApprove.methods.setMode({ mode: "auto" });
		expect(autoApprove.getState().mode).toBe("auto");
		await kernel.kernelSdk.domainObjects.get(AutoApprove)!.methods.setMode({ mode: "manual" });
		expect(autoApprove.getState().mode).toBe("manual");
		await expect(
			as("kilo.core").get(AutoApprove)!.methods.setMode({ mode: "auto" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		expect(autoApprove.getState().mode).toBe("manual");
	});

	it("lets desktop tools proceed when a chat is created", async () => {
		const { core } = await boot({ plugins: [signInToolPlugin()] });

		const decision = await core.sdk!.extensions.decide(ToolApproval, {
			tool: SIGN_IN_TOOL,
			input: undefined,
			chatId: null,
			workSessionId: "wses_1",
			external: false,
		});

		expect(decision.outcome).toBe("proceed");
	});
});
