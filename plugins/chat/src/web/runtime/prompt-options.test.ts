import type { ThreadUserMessagePart } from "@assistant-ui/react";
import type { SessionInfo } from "@kilo-desktop/react-opencode";
import type { OpenCodeClient } from "@kilocode/client";
import { describe, expect, it, vi } from "vitest";

import { session } from "../../test/kilo2/fixtures";
import { createPromptSender, type PromptOptions } from "./prompt-options";

function fakeClient(info: Partial<SessionInfo> = {}) {
	const calls: string[] = [];
	const record =
		<T>(name: string, value: T) =>
		async (..._args: unknown[]) => {
			calls.push(name);
			return value;
		};
	const stored = session("ses_a", { directory: "/repo", ...info });
	const client = {
		session: {
			get: vi.fn(record("session.get", stored)),
			switchAgent: vi.fn(record("session.switchAgent", undefined)),
			switchModel: vi.fn(record("session.switchModel", undefined)),
			prompt: vi.fn(record("session.prompt", {})),
			command: vi.fn(record("session.command", undefined)),
		},
		mcp: { list: vi.fn(record("mcp.list", { data: [] })) },
	};
	return { client: client as unknown as OpenCodeClient, calls, ...client.session, mcp: client.mcp };
}

function send(
	client: OpenCodeClient,
	options: PromptOptions,
	parts: readonly ThreadUserMessagePart[] = [{ type: "text", text: "hi" }],
	defaults = {},
) {
	return createPromptSender(
		client,
		options,
	)({
		sessionId: "ses_a",
		messageId: "msg_1",
		parts,
		options: defaults,
	});
}

describe("createPromptSender", () => {
	it("prompts with the runtime's message id and the chat's system prompt on its metadata", async () => {
		const { client, prompt } = fakeClient();
		const getSystem = vi.fn(async () => "Workspace context");

		await send(client, { getSystem });

		expect(getSystem).toHaveBeenCalledWith("ses_a");
		expect(prompt).toHaveBeenCalledWith({
			sessionID: "ses_a",
			id: "msg_1",
			text: "hi",
			metadata: { "kilo-desktop": { system: "Workspace context" } },
		});
	});

	it("sends a prompt without a system prompt without metadata", async () => {
		const { client, prompt } = fakeClient();

		await send(client, { getSystem: () => undefined });

		expect(prompt).toHaveBeenCalledWith({ sessionID: "ses_a", id: "msg_1", text: "hi" });
	});

	it("switches the session to the chosen agent and model, with its variant, before prompting", async () => {
		const { client, calls, switchAgent, switchModel } = fakeClient();

		await send(client, {
			getAgent: () => "plan",
			getModel: () => ({ providerID: "kilo", modelID: "m" }),
			getVariant: () => "high",
		});

		expect(switchAgent).toHaveBeenCalledWith({ sessionID: "ses_a", agent: "plan" });
		expect(switchModel).toHaveBeenCalledWith({
			sessionID: "ses_a",
			model: { providerID: "kilo", id: "m", variant: "high" },
		});
		expect(calls.indexOf("session.switchModel")).toBeLessThan(calls.indexOf("session.prompt"));
	});

	it("switches nothing the session already has", async () => {
		const { client, switchAgent, switchModel } = fakeClient({
			agent: "plan",
			model: { providerID: "kilo", id: "m", variant: "default" },
		});

		await send(client, {
			getAgent: () => "plan",
			getModel: () => ({ providerID: "kilo", modelID: "m" }),
			getVariant: () => undefined,
		});

		expect(switchAgent).not.toHaveBeenCalled();
		expect(switchModel).not.toHaveBeenCalled();
	});

	it("falls back to the runtime's options when the pane chose nothing", async () => {
		const { client, switchAgent } = fakeClient();

		await send(client, {}, undefined, { agent: "ask" });

		expect(switchAgent).toHaveBeenCalledWith({ sessionID: "ses_a", agent: "ask" });
	});

	it("resolves mentions into text and files, attachments after them", async () => {
		const { client, prompt } = fakeClient();
		const resolveParts = vi.fn(async () => [
			{ type: "text", text: "see notes.md" },
			{ type: "file", url: "file:///repo/notes.md", mime: "text/markdown", filename: "notes.md" },
		]);

		await send(client, { resolveParts }, [
			{ type: "text", text: "see @notes" },
			{ type: "image", image: "data:image/png;base64,aGk=", filename: "shot.png" },
		]);

		expect(resolveParts).toHaveBeenCalledWith([{ type: "text", text: "see @notes" }]);
		expect(prompt).toHaveBeenCalledWith(
			expect.objectContaining({
				text: "see notes.md",
				files: [
					{ uri: "file:///repo/notes.md", name: "notes.md" },
					{ uri: "data:image/png;base64,aGk=", name: "shot.png" },
				],
			}),
		);
	});

	it("warms the chat's MCP servers before prompting", async () => {
		const { client, calls, mcp } = fakeClient();

		await send(client, {});

		expect(mcp.list).toHaveBeenCalledWith({ location: { directory: "/repo" } });
		expect(calls.indexOf("mcp.list")).toBeLessThan(calls.indexOf("session.prompt"));
	});

	it("waits for the model to be prepared before anything reaches Kilo's session", async () => {
		const { client, calls } = fakeClient();
		let release!: () => void;
		const prepareModel = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);

		const pending = send(client, {
			getModel: () => ({ providerID: "kilo-desktop-model-server", modelID: "qwen-3" }),
			prepareModel,
		});
		await vi.waitFor(() => expect(prepareModel).toHaveBeenCalledOnce());

		expect(prepareModel).toHaveBeenCalledWith({
			providerID: "kilo-desktop-model-server",
			modelID: "qwen-3",
		});
		expect(calls).toEqual([]);
		release();
		await pending;
		expect(calls).toContain("session.prompt");
	});

	it("prepares no model when none is chosen", async () => {
		const { client } = fakeClient();
		const prepareModel = vi.fn(async () => undefined);

		await send(client, { getModel: () => undefined, prepareModel });

		expect(prepareModel).not.toHaveBeenCalled();
	});

	it("says when the server accepted a prompt, and when preparing or sending it failed", async () => {
		const onPrompted = vi.fn();
		const onPromptFailed = vi.fn();
		const accepted = fakeClient();
		await send(accepted.client, { onPrompted, onPromptFailed });
		expect(onPrompted).toHaveBeenCalledWith("ses_a");

		const refused = fakeClient();
		refused.prompt.mockRejectedValueOnce(new Error("busy"));
		await expect(send(refused.client, { onPrompted, onPromptFailed })).rejects.toThrow("busy");

		const unprepared = fakeClient();
		await expect(
			send(unprepared.client, {
				onPromptFailed,
				getSystem: async () => {
					throw new Error("No config");
				},
			}),
		).rejects.toThrow("No config");

		expect(onPrompted).toHaveBeenCalledOnce();
		expect(onPromptFailed).toHaveBeenCalledTimes(2);
		expect(unprepared.prompt).not.toHaveBeenCalled();
	});
});

describe("createPromptSender slash commands", () => {
	it("runs a known `/name args` prompt as the command, after switching agent and model", async () => {
		const { client, calls, command, prompt } = fakeClient();

		await send(
			client,
			{
				getAgent: () => "code",
				getModel: () => ({ providerID: "kilo", modelID: "auto" }),
				getKnownCommandNames: () => ["init", "compact"],
				getSystem: () => "Context",
			},
			[{ type: "text", text: "/init write AGENTS.md" }],
		);

		expect(prompt).not.toHaveBeenCalled();
		expect(command).toHaveBeenCalledWith({
			sessionID: "ses_a",
			name: "init",
			text: "write AGENTS.md",
		});
		expect(calls.indexOf("session.switchModel")).toBeLessThan(calls.indexOf("session.command"));
	});

	it("finds the command in the text mentions resolve to", async () => {
		const { client, command } = fakeClient();

		await send(
			client,
			{
				getKnownCommandNames: () => ["review"],
				resolveParts: async () => [{ type: "text", text: "/review src/app.ts" }],
			},
			[{ type: "text", text: "/review @app" }],
		);

		expect(command).toHaveBeenCalledWith(
			expect.objectContaining({ name: "review", text: "src/app.ts" }),
		);
	});

	it("leaves unknown or plain prompts on session.prompt", async () => {
		const { client, command, prompt } = fakeClient();

		await send(client, { getKnownCommandNames: () => ["init"] }, [{ type: "text", text: "/nope" }]);
		await send(client, { getKnownCommandNames: () => ["init"] });

		expect(command).not.toHaveBeenCalled();
		expect(prompt).toHaveBeenCalledTimes(2);
	});

	it("says a command was accepted, or failed", async () => {
		const onPrompted = vi.fn();
		const onPromptFailed = vi.fn();
		const accepted = fakeClient();
		await send(accepted.client, { onPrompted, getKnownCommandNames: () => ["init"] }, [
			{ type: "text", text: "/init" },
		]);
		const refused = fakeClient();
		refused.command.mockRejectedValueOnce(new Error("Unknown command"));

		await expect(
			send(refused.client, { onPromptFailed, getKnownCommandNames: () => ["init"] }, [
				{ type: "text", text: "/init" },
			]),
		).rejects.toThrow("Unknown command");

		expect(onPrompted).toHaveBeenCalledWith("ses_a");
		expect(onPromptFailed).toHaveBeenCalledWith("ses_a");
	});
});
