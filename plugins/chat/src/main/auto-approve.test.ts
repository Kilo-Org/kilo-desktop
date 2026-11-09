import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import { needsPerson } from "./auto-approve";
import { bootChatMain, chat, request, settle } from "./test-helpers";

afterEach(() => {
	vi.useRealTimers();
});

const ask = (
	booted: Awaited<ReturnType<typeof bootChatMain>>,
	chatId: string,
	permissionId: string,
) => booted.fake.conversations!.emit("permission-requested", { chatId, permissionId });

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
		const booted = await bootChatMain({ chats: [chat("ses_a")] });
		await booted.autoApprove.methods.setMode({ mode: "auto" });
		booted.fake.requests.set("ses_a", [request("per_1", "ses_a")]);

		ask(booted, "ses_a", "per_1");
		expect(booted.autoApprove.getState().holding).toEqual(["per_1"]);
		await settle();

		expect(booted.fake.replies).toEqual([
			{ chatId: "ses_a", permissionId: "per_1", reply: "once" },
		]);
		booted.fake.conversations!.emit("permission-resolved", {
			chatId: "ses_a",
			permissionId: "per_1",
		});
		expect(booted.autoApprove.getState().holding).toEqual([]);
	});

	it("shows the request when the reply fails, or after the reveal delay", async () => {
		const booted = await bootChatMain({ chats: [chat("ses_a")], revealAfterMs: 20 });
		await booted.autoApprove.methods.setMode({ mode: "auto" });
		booted.fake.requests.set("ses_a", [request("per_1", "ses_a"), request("per_2", "ses_a")]);

		booted.fake.failReplies = true;
		ask(booted, "ses_a", "per_1");
		await settle();
		expect(booted.autoApprove.getState().holding).toEqual([]);

		booted.fake.failReplies = false;
		ask(booted, "ses_a", "per_2");
		await settle();
		expect(booted.autoApprove.getState().holding).toEqual(["per_2"]);
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(booted.autoApprove.getState().holding).toEqual([]);
	});

	it("leaves sandbox escalation and protected config to a person, and answers skill-shell unheld", async () => {
		const booted = await bootChatMain({ chats: [chat("ses_a")] });
		await booted.autoApprove.methods.setMode({ mode: "auto" });
		booted.fake.requests.set("ses_a", [
			request("per_sandbox", "ses_a", { metadata: { sandboxEscalation: true } }),
			request("per_config", "ses_a", { metadata: { configProtected: true } }),
			request("per_skill", "ses_a", { metadata: { skillShell: true } }),
		]);

		ask(booted, "ses_a", "per_sandbox");
		ask(booted, "ses_a", "per_config");
		ask(booted, "ses_a", "per_skill");
		await settle();

		expect(booted.fake.replies.map((reply) => reply.permissionId)).toEqual(["per_skill"]);
		expect(booted.autoApprove.getState().holding).toEqual([]);
	});

	it("shows a request it can't read or that is gone", async () => {
		const booted = await bootChatMain({ chats: [chat("ses_a")] });
		await booted.autoApprove.methods.setMode({ mode: "auto" });

		ask(booted, "ses_a", "per_gone");
		booted.fake.failReads = true;
		ask(booted, "ses_a", "per_unreadable");
		await settle();

		expect(booted.fake.replies).toEqual([]);
		expect(booted.autoApprove.getState().holding).toEqual([]);
	});

	it("drains pending requests when Auto turns on and when the chat list becomes ready", async () => {
		const booted = await bootChatMain({
			chats: [chat("ses_a", ["per_1"]), chat("ses_b", ["per_2"])],
			ready: false,
		});
		booted.fake.requests.set("ses_a", [request("per_1", "ses_a")]);
		booted.fake.requests.set("ses_b", [request("per_2", "ses_b")]);

		await booted.autoApprove.methods.setMode({ mode: "auto" });
		await settle();
		expect(booted.fake.replies).toEqual([]);

		booted.fake.conversations!.setState({ ...booted.fake.conversations!.state, ready: true });
		await settle();
		await settle();
		expect(booted.fake.replies.map((reply) => reply.permissionId)).toEqual(["per_1", "per_2"]);
	});

	it("stops a drain when switched back to manual", async () => {
		const booted = await bootChatMain({
			chats: [chat("ses_a", ["per_1", "per_2"])],
		});
		booted.fake.requests.set("ses_a", [request("per_1", "ses_a"), request("per_2", "ses_a")]);

		await booted.autoApprove.methods.setMode({ mode: "auto" });
		await booted.autoApprove.methods.setMode({ mode: "manual" });
		await settle();
		await settle();

		expect(booted.fake.replies.length).toBeLessThanOrEqual(1);
	});

	it("does not answer a request it was reading when the person switched back to manual", async () => {
		const booted = await bootChatMain({ chats: [chat("ses_a")], signedIn: true });
		await booted.autoApprove.methods.setMode({ mode: "auto" });
		booted.fake.requests.set("ses_a", [request("per_1", "ses_a")]);
		let finishRead = () => {};
		booted.fake.readGate = new Promise<void>((resolve) => (finishRead = resolve));

		ask(booted, "ses_a", "per_1");
		await settle();
		await booted.autoApprove.methods.setMode({ mode: "manual" });
		finishRead();
		await settle();
		await settle();

		expect(booted.fake.replies).toEqual([]);
		expect(booted.autoApprove.getState().holding).toEqual([]);
	});
});

describe("manual mode", () => {
	it("answers a sign-in tool's request while signed out, so chat's sign-in prompt comes first", async () => {
		const booted = await bootChatMain({ chats: [chat("ses_a")], signedIn: false });
		booted.fake.requests.set("ses_a", [
			request("per_tool", "ses_a", { permission: "desktop_agent_terminal_open" }),
			request("per_bash", "ses_a"),
		]);

		ask(booted, "ses_a", "per_tool");
		ask(booted, "ses_a", "per_bash");
		await settle();

		expect(booted.fake.replies.map((reply) => reply.permissionId)).toEqual(["per_tool"]);
		expect(booted.autoApprove.getState().holding).toEqual(["per_tool"]);
	});

	it("leaves every request alone while signed in", async () => {
		const booted = await bootChatMain({ chats: [chat("ses_a")], signedIn: true });
		booted.fake.requests.set("ses_a", [
			request("per_tool", "ses_a", { permission: "desktop_agent_terminal_open" }),
		]);

		ask(booted, "ses_a", "per_tool");
		await settle();

		expect(booted.fake.replies).toEqual([]);
		expect(booted.autoApprove.getState().holding).toEqual([]);
	});

	it("leaves a sign-in tool's request that needs a person alone", async () => {
		const booted = await bootChatMain({ chats: [chat("ses_a")], signedIn: false });
		booted.fake.requests.set("ses_a", [
			request("per_tool", "ses_a", {
				permission: "desktop_agent_terminal_open",
				metadata: { skillShell: true },
			}),
		]);

		ask(booted, "ses_a", "per_tool");
		await settle();

		expect(booted.fake.replies).toEqual([]);
	});
});

describe("the mode", () => {
	it("is kept across restarts and takes origin's value once", async () => {
		const storage = createMemoryStorage("/data/kilo.chat");
		const first = await bootChatMain({ storage, withoutAgent: true });
		await first.asChat.autoApprove.methods.importLegacyMode({ mode: "auto" });
		expect(first.autoApprove.getState().mode).toBe("auto");
		await first.autoApprove.methods.setMode({ mode: "manual" });
		await first.asChat.autoApprove.methods.importLegacyMode({ mode: "auto" });

		const restarted = await bootChatMain({ storage, withoutAgent: true });
		expect(restarted.autoApprove.getState().mode).toBe("manual");
	});

	it("is changed only by kilo.chat and the kernel", async () => {
		const booted = await bootChatMain({ withoutAgent: true });

		await booted.asChat.autoApprove.methods.setMode({ mode: "auto" });
		expect(booted.autoApprove.getState().mode).toBe("auto");
		await expect(
			booted.as("kilo.account").autoApprove.methods.setMode({ mode: "manual" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		expect(booted.autoApprove.getState().mode).toBe("auto");
	});

	it("takes origin's value only from kilo.chat", async () => {
		const booted = await bootChatMain({ withoutAgent: true });
		await expect(
			booted.autoApprove.methods.importLegacyMode({ mode: "auto" }),
		).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
	});
});
