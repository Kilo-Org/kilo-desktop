import { describe, expect, it, vi } from "vitest";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import { withPromptOptions } from "./with-prompt-options.js";

describe("withPromptOptions", () => {
	it("injects variant into promptAsync when unset", async () => {
		const promptAsync = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync, prompt: vi.fn() },
		} as unknown as KiloClient;

		const wrapped = withPromptOptions(client, { getVariant: () => "high" });
		await wrapped.session.promptAsync({
			sessionID: "s1",
			parts: [{ type: "text", text: "hi" }],
		});

		expect(promptAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionID: "s1",
				variant: "high",
			}),
		);
	});

	it("does not override an explicit variant", async () => {
		const promptAsync = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync, prompt: vi.fn() },
		} as unknown as KiloClient;

		const wrapped = withPromptOptions(client, { getVariant: () => "high" });
		await wrapped.session.promptAsync({
			sessionID: "s1",
			parts: [{ type: "text", text: "hi" }],
			variant: "max",
		});

		expect(promptAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				variant: "max",
			}),
		);
	});

	it("overrides a stale agent with the live selection", async () => {
		const promptAsync = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync, prompt: vi.fn() },
		} as unknown as KiloClient;

		let agent = "code";
		const wrapped = withPromptOptions(client, { getAgent: () => agent });

		agent = "plan";
		await wrapped.session.promptAsync({
			sessionID: "s1",
			parts: [{ type: "text", text: "hi" }],
			agent: "code",
		});

		expect(promptAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				agent: "plan",
			}),
		);
	});

	it("overrides a stale model with the live selection", async () => {
		const promptAsync = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync, prompt: vi.fn() },
		} as unknown as KiloClient;

		let model = { providerID: "anthropic", modelID: "claude-sonnet" };
		const wrapped = withPromptOptions(client, { getModel: () => model });

		model = { providerID: "openai", modelID: "gpt-5" };
		await wrapped.session.promptAsync({
			sessionID: "s1",
			parts: [{ type: "text", text: "hi" }],
			model: { providerID: "anthropic", modelID: "claude-sonnet" },
		});

		expect(promptAsync).toHaveBeenCalledWith(
			expect.objectContaining({
				model: { providerID: "openai", modelID: "gpt-5" },
			}),
		);
	});

	it("injects agent and model into prompt as well", async () => {
		const prompt = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync: vi.fn(), prompt },
		} as unknown as KiloClient;

		const wrapped = withPromptOptions(client, {
			getAgent: () => "ask",
			getModel: () => ({ providerID: "kilo", modelID: "auto" }),
			getVariant: () => "low",
		});
		await wrapped.session.prompt({
			sessionID: "s1",
			parts: [{ type: "text", text: "hi" }],
		});

		expect(prompt).toHaveBeenCalledWith(
			expect.objectContaining({
				agent: "ask",
				model: { providerID: "kilo", modelID: "auto" },
				variant: "low",
			}),
		);
	});

	it("prepends session workspace context without discarding an explicit system prompt", async () => {
		const prompt = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync: vi.fn(), prompt },
		} as unknown as KiloClient;

		const wrapped = withPromptOptions(client, {
			getSystem: (input) =>
				input.sessionID === "workspace-session"
					? "Workspace folders: /main, /reference"
					: undefined,
		});
		await wrapped.session.prompt({
			sessionID: "workspace-session",
			parts: [{ type: "text", text: "hi" }],
			system: "Answer concisely.",
		});

		expect(prompt).toHaveBeenCalledWith(
			expect.objectContaining({
				system: "Workspace folders: /main, /reference\n\nAnswer concisely.",
			}),
		);
	});
});
