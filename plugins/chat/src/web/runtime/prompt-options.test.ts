import type { KiloClient } from "@kilocode/sdk/v2/client";
import { describe, expect, it, vi } from "vitest";

import { SNAPSHOT_INITIALIZATION, withPromptOptions } from "./prompt-options";

function fakeClient() {
	const prompt = vi.fn(async (args: unknown) => args);
	const promptAsync = vi.fn(async (args: unknown) => args);
	const abort = vi.fn(async () => true);
	const client = { session: { prompt, promptAsync, abort }, global: { health: vi.fn() } };
	return { client: client as unknown as KiloClient, prompt, promptAsync, abort, raw: client };
}

describe("withPromptOptions", () => {
	it("adds the snapshot policy and the chat's system prompt", async () => {
		const { client, promptAsync } = fakeClient();
		const getSystem = vi.fn(async () => "Workspace context");
		const wrapped = withPromptOptions(client, { getSystem });

		await wrapped.session.promptAsync({ sessionID: "ses_a", parts: [] } as never);

		expect(getSystem).toHaveBeenCalledWith("ses_a");
		expect(promptAsync).toHaveBeenCalledWith({
			sessionID: "ses_a",
			parts: [],
			snapshotInitialization: SNAPSHOT_INITIALIZATION,
			system: "Workspace context",
		});
	});

	it("puts its system prompt before the prompt's own", async () => {
		const { client, prompt } = fakeClient();
		const wrapped = withPromptOptions(client, { getSystem: () => "Context" });

		await wrapped.session.prompt({ sessionID: "ses_a", system: "Be brief" } as never);

		expect(prompt.mock.calls[0]![0]).toMatchObject({ system: "Context\n\nBe brief" });
	});

	it("always applies the chosen agent and model, and a variant only when unset", async () => {
		const { client, prompt } = fakeClient();
		const wrapped = withPromptOptions(client, {
			getAgent: () => "plan",
			getModel: () => ({ providerID: "kilo", modelID: "m" }),
			getVariant: () => "high",
		});

		await wrapped.session.prompt({ agent: "code", variant: "low" } as never);
		await wrapped.session.prompt({} as never);

		expect(prompt.mock.calls[0]![0]).toEqual({
			agent: "plan",
			variant: "low",
			model: { providerID: "kilo", modelID: "m" },
			snapshotInitialization: "wait",
		});
		expect(prompt.mock.calls[1]![0]).toMatchObject({ variant: "high" });
	});

	it("leaves a prompt without a system prompt alone, and other calls untouched", async () => {
		const { client, prompt, abort, raw } = fakeClient();
		const wrapped = withPromptOptions(client, { getSystem: () => undefined });

		await wrapped.session.prompt({ sessionID: "ses_a" } as never);
		await wrapped.session.abort({ sessionID: "ses_a" } as never);

		expect(prompt.mock.calls[0]![0]).not.toHaveProperty("system");
		expect(abort).toHaveBeenCalledWith({ sessionID: "ses_a" });
		expect(wrapped.global).toBe(raw.global);
	});
});

describe("withPromptOptions mentions", () => {
	it("resolves the parts before they are sent", async () => {
		const { client, promptAsync } = fakeClient();
		const wrapped = withPromptOptions(client, {
			resolveParts: async (parts) => [
				...parts,
				{ type: "file", url: "file:///a", mime: "text/plain" },
			],
		});

		await wrapped.session.promptAsync({
			sessionID: "ses_a",
			parts: [{ type: "text", text: "hi" }],
		} as never);

		expect(promptAsync.mock.calls[0]![0]).toMatchObject({
			parts: [
				{ type: "text", text: "hi" },
				{ type: "file", url: "file:///a", mime: "text/plain" },
			],
		});
	});

	it("says when the server accepted a prompt, and not when it refused", async () => {
		const { client, promptAsync } = fakeClient();
		const onPrompted = vi.fn();
		const wrapped = withPromptOptions(client, { onPrompted });

		await wrapped.session.promptAsync({ sessionID: "ses_a", parts: [] } as never);
		expect(onPrompted).toHaveBeenCalledWith("ses_a");

		promptAsync.mockRejectedValueOnce(new Error("busy"));
		await expect(
			wrapped.session.promptAsync({ sessionID: "ses_b", parts: [] } as never),
		).rejects.toThrow("busy");
		expect(onPrompted).not.toHaveBeenCalledWith("ses_b");
	});

	it("says a known slash command was accepted once it is on its way", async () => {
		const command = vi.fn(() => new Promise(() => {}));
		const client = { session: { promptAsync: vi.fn(), prompt: vi.fn(), command } };
		const onPrompted = vi.fn();
		const wrapped = withPromptOptions(client as unknown as KiloClient, {
			onPrompted,
			getKnownCommandNames: () => ["init"],
		});

		await wrapped.session.promptAsync({
			sessionID: "ses_a",
			parts: [{ type: "text", text: "/init" }],
		} as never);

		expect(command).toHaveBeenCalled();
		expect(onPrompted).toHaveBeenCalledWith("ses_a");
	});

	it("says a prompt failed when preparing it fails, before anything is sent", async () => {
		const { client, promptAsync } = fakeClient();
		const onPrompted = vi.fn();
		const onPromptFailed = vi.fn();
		const wrapped = withPromptOptions(client, {
			onPrompted,
			onPromptFailed,
			getSystem: async () => {
				throw new Error("No config");
			},
		});

		await expect(
			wrapped.session.promptAsync({ sessionID: "ses_a", parts: [] } as never),
		).rejects.toThrow("No config");

		expect(onPromptFailed).toHaveBeenCalledWith("ses_a");
		expect(onPrompted).not.toHaveBeenCalled();
		expect(promptAsync).not.toHaveBeenCalled();
	});

	it("says a prompt failed when the server refuses it", async () => {
		const { client, promptAsync } = fakeClient();
		const onPromptFailed = vi.fn();
		const wrapped = withPromptOptions(client, { onPromptFailed });
		promptAsync.mockRejectedValueOnce(new Error("busy"));

		await expect(
			wrapped.session.promptAsync({ sessionID: "ses_a", parts: [] } as never),
		).rejects.toThrow("busy");

		expect(onPromptFailed).toHaveBeenCalledWith("ses_a");
	});

	it("says a command failed when preparing or sending it fails", async () => {
		const command = vi.fn(async () => {
			throw new Error("Unknown command");
		});
		const client = { session: { promptAsync: vi.fn(), prompt: vi.fn(), command } };
		const onPromptFailed = vi.fn();
		const wrapped = withPromptOptions(client as unknown as KiloClient, { onPromptFailed });

		await expect(
			wrapped.session.command({ sessionID: "ses_a", command: "nope", arguments: "" } as never),
		).rejects.toThrow("Unknown command");

		expect(onPromptFailed).toHaveBeenCalledWith("ses_a");
	});
});
