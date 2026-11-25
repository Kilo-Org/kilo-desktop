import type { KiloClient } from "@kilo-desktop/react-opencode-v2";
import { describe, expect, it, vi } from "vitest";

import { withPromptOptions } from "./prompt-options";

/** A Kilo client whose session calls are recorded in order. */
function fakeClient(overrides: Record<string, (...args: never[]) => unknown> = {}) {
	const calls: [string, unknown][] = [];
	const record = (name: string, answer: () => unknown = () => undefined) =>
		vi.fn(async (input: unknown) => {
			calls.push([name, input]);
			return answer();
		});
	const session = {
		switchAgent: record("switchAgent"),
		switchModel: record("switchModel"),
		synthetic: record("synthetic"),
		prompt: record("prompt", () => ({ id: "msg_1" })),
		command: record("command"),
		interrupt: record("interrupt"),
		...overrides,
	};
	const client = { session, mcp: { list: vi.fn() } };
	return { client: client as unknown as KiloClient, calls, session, raw: client };
}

describe("withPromptOptions", () => {
	it("switches agent and model and adds the system note before the prompt", async () => {
		const { client, calls } = fakeClient();
		const getSystem = vi.fn(async () => "Workspace context");
		const wrapped = withPromptOptions(client, {
			getAgent: () => "plan",
			getModel: () => ({ providerID: "kilo", id: "m", variant: "high" }),
			getSystem,
		});

		await expect(wrapped.session.prompt({ sessionID: "ses_a", text: "hi" })).resolves.toEqual({
			id: "msg_1",
		});

		expect(getSystem).toHaveBeenCalledWith("ses_a");
		expect(calls).toEqual([
			["switchAgent", { sessionID: "ses_a", agent: "plan" }],
			[
				"switchModel",
				{ sessionID: "ses_a", model: { providerID: "kilo", id: "m", variant: "high" } },
			],
			[
				"synthetic",
				{
					sessionID: "ses_a",
					text: "<system-reminder>\nWorkspace context\n</system-reminder>",
					resume: false,
				},
			],
			["prompt", { sessionID: "ses_a", text: "hi" }],
		]);
	});

	it("sends a prompt as it came without options, and leaves other calls untouched", async () => {
		const { client, calls, raw } = fakeClient();
		const wrapped = withPromptOptions(client, { getSystem: () => undefined });

		await wrapped.session.prompt({ sessionID: "ses_a", text: "hi", resume: false });
		await wrapped.session.interrupt({ sessionID: "ses_a" });

		expect(calls).toEqual([
			["prompt", { sessionID: "ses_a", text: "hi", resume: false }],
			["interrupt", { sessionID: "ses_a" }],
		]);
		expect(wrapped.mcp).toBe(raw.mcp);
	});

	it("waits for local model preparation before the model is switched to", async () => {
		let release!: () => void;
		const prepareModel = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		const { client, calls } = fakeClient();
		const wrapped = withPromptOptions(client, {
			getModel: () => ({ providerID: "kilo-desktop-model-server", id: "qwen-3" }),
			prepareModel,
		});

		const pending = wrapped.session.prompt({ sessionID: "s1", text: "hi" });
		await vi.waitFor(() => expect(prepareModel).toHaveBeenCalledOnce());

		expect(prepareModel).toHaveBeenCalledWith({
			providerID: "kilo-desktop-model-server",
			id: "qwen-3",
		});
		expect(calls).toEqual([]);
		release();
		await pending;
		expect(calls.map(([name]) => name)).toEqual(["switchModel", "prompt"]);
	});
});

describe("withPromptOptions mentions", () => {
	it("resolves the text's mentions, adding the files they bring", async () => {
		const { client, session } = fakeClient();
		const wrapped = withPromptOptions(client, {
			resolveParts: async (parts) => [
				{ type: "text", text: `${String(parts[0]!.text)} (resolved)` },
				{ type: "file", url: "file:///a", mime: "text/plain", filename: "a" },
			],
		});

		await wrapped.session.prompt({
			sessionID: "ses_a",
			text: "hi",
			files: [{ uri: "data:image/png;base64,AQID" }],
		});

		expect(session.prompt).toHaveBeenCalledWith(
			{
				sessionID: "ses_a",
				text: "hi (resolved)",
				files: [{ uri: "data:image/png;base64,AQID" }, { uri: "file:///a", name: "a" }],
			},
			undefined,
		);
	});

	it("says when the server accepted a prompt, and not when it refused", async () => {
		const { client, session } = fakeClient();
		const onPrompted = vi.fn();
		const wrapped = withPromptOptions(client, { onPrompted });

		await wrapped.session.prompt({ sessionID: "ses_a", text: "" });
		expect(onPrompted).toHaveBeenCalledWith("ses_a");

		session.prompt.mockRejectedValueOnce(new Error("busy"));
		await expect(wrapped.session.prompt({ sessionID: "ses_b", text: "" })).rejects.toThrow("busy");
		expect(onPrompted).not.toHaveBeenCalledWith("ses_b");
	});

	it("runs a known slash prompt as its command, prepared the same way", async () => {
		const { client, calls } = fakeClient();
		const wrapped = withPromptOptions(client, {
			getAgent: () => "code",
			getModel: () => ({ providerID: "kilo", id: "auto" }),
			getKnownCommandNames: () => ["init", "compact"],
		});

		await wrapped.session.prompt({ sessionID: "s1", text: "/init write AGENTS.md" });

		expect(calls).toEqual([
			["switchAgent", { sessionID: "s1", agent: "code" }],
			["switchModel", { sessionID: "s1", model: { providerID: "kilo", id: "auto" } }],
			["command", { sessionID: "s1", name: "init", text: "write AGENTS.md" }],
		]);
	});

	it("sends a known skill's arguments as a prompt naming the skill", async () => {
		const { client, calls } = fakeClient();
		const wrapped = withPromptOptions(client, {
			getKnownCommandNames: () => ["init"],
			getKnownSkills: () => new Map([["tidy:skill", "tidy"]]),
		});

		await wrapped.session.prompt({ sessionID: "s1", text: "/tidy:skill the imports" });

		expect(calls).toEqual([
			["prompt", { sessionID: "s1", text: "the imports", skills: [{ id: "tidy" }] }],
		]);
	});

	it("leaves unknown or non-slash prompts on session.prompt", async () => {
		const { client, calls } = fakeClient();
		const wrapped = withPromptOptions(client, { getKnownCommandNames: () => ["init"] });

		await wrapped.session.prompt({ sessionID: "s1", text: "hello" });
		await wrapped.session.prompt({ sessionID: "s1", text: "/unknown" });

		expect(calls.map(([name]) => name)).toEqual(["prompt", "prompt"]);
	});

	it("says a known slash command was accepted once it is on its way, without waiting for it", async () => {
		const { client, session } = fakeClient({ command: vi.fn(() => new Promise(() => {})) });
		const onPrompted = vi.fn();
		const wrapped = withPromptOptions(client, {
			onPrompted,
			getKnownCommandNames: () => ["init"],
		});

		await wrapped.session.prompt({ sessionID: "ses_a", text: "/init" });

		expect(session.command).toHaveBeenCalled();
		expect(onPrompted).toHaveBeenCalledWith("ses_a");
	});

	it("says a prompt failed when preparing it fails, before anything is sent", async () => {
		const { client, calls } = fakeClient();
		const onPrompted = vi.fn();
		const onPromptFailed = vi.fn();
		const wrapped = withPromptOptions(client, {
			onPrompted,
			onPromptFailed,
			getAgent: () => "code",
			getSystem: async () => {
				throw new Error("No config");
			},
		});

		await expect(wrapped.session.prompt({ sessionID: "ses_a", text: "" })).rejects.toThrow(
			"No config",
		);

		expect(onPromptFailed).toHaveBeenCalledWith("ses_a");
		expect(onPrompted).not.toHaveBeenCalled();
		expect(calls).toEqual([]);
	});

	it("says a prompt failed when the server refuses it", async () => {
		const { client, session } = fakeClient();
		const onPromptFailed = vi.fn();
		const wrapped = withPromptOptions(client, { onPromptFailed });
		session.prompt.mockRejectedValueOnce(new Error("busy"));

		await expect(wrapped.session.prompt({ sessionID: "ses_a", text: "" })).rejects.toThrow("busy");

		expect(onPromptFailed).toHaveBeenCalledWith("ses_a");
	});

	it("prepares a command too, and says it failed when sending it fails", async () => {
		const { client, calls, session } = fakeClient();
		session.command.mockRejectedValueOnce(new Error("Unknown command"));
		const onPromptFailed = vi.fn();
		const wrapped = withPromptOptions(client, { onPromptFailed, getAgent: () => "ask" });

		await expect(
			wrapped.session.command({ sessionID: "ses_a", name: "nope", text: "" }),
		).rejects.toThrow("Unknown command");

		expect(calls).toEqual([["switchAgent", { sessionID: "ses_a", agent: "ask" }]]);
		expect(session.command).toHaveBeenCalledWith(
			{ sessionID: "ses_a", name: "nope", text: "" },
			undefined,
		);
		expect(onPromptFailed).toHaveBeenCalledWith("ses_a");
	});
});
