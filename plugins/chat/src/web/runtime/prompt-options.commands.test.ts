import { describe, expect, it, vi } from "vitest";

import type { KiloClient } from "@kilocode/sdk/v2/client";

import { withPromptOptions } from "./prompt-options";

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

	it("waits for local model preparation before promptAsync reaches Kilo", async () => {
		let release!: () => void;
		const preparation = new Promise<void>((resolve) => {
			release = resolve;
		});
		const prepareModel = vi.fn(() => preparation);
		const promptAsync = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync, prompt: vi.fn() },
		} as unknown as KiloClient;
		const wrapped = withPromptOptions(client, {
			getModel: () => ({ providerID: "kilo-desktop-model-server", modelID: "qwen-3" }),
			prepareModel,
		});

		const pending = wrapped.session.promptAsync({
			sessionID: "s1",
			parts: [{ type: "text", text: "hi" }],
		});
		await Promise.resolve();

		expect(prepareModel).toHaveBeenCalledWith({
			providerID: "kilo-desktop-model-server",
			modelID: "qwen-3",
		});
		expect(promptAsync).not.toHaveBeenCalled();
		release();
		await pending;
		expect(promptAsync).toHaveBeenCalledOnce();
	});

	it("waits for local model preparation before prompt reaches Kilo", async () => {
		const order: string[] = [];
		const prepareModel = vi.fn(async () => {
			order.push("prepare");
		});
		const prompt = vi.fn(async () => {
			order.push("prompt");
		});
		const client = {
			session: { promptAsync: vi.fn(), prompt },
		} as unknown as KiloClient;
		const wrapped = withPromptOptions(client, {
			getModel: () => ({ providerID: "kilo-desktop-model-server", modelID: "llama-3" }),
			prepareModel,
		});

		await wrapped.session.prompt({
			sessionID: "s1",
			parts: [{ type: "text", text: "hi" }],
		});

		expect(order).toEqual(["prepare", "prompt"]);
		expect(prepareModel).toHaveBeenCalledWith({
			providerID: "kilo-desktop-model-server",
			modelID: "llama-3",
		});
	});

	it("forwards prompts without a model without preparing one", async () => {
		const prepareModel = vi.fn(async () => undefined);
		const prompt = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync: vi.fn(), prompt },
		} as unknown as KiloClient;
		const wrapped = withPromptOptions(client, {
			getModel: () => undefined,
			prepareModel,
		});

		await wrapped.session.prompt({
			sessionID: "s1",
			parts: [{ type: "text", text: "hi" }],
		});

		expect(prepareModel).not.toHaveBeenCalled();
		expect(prompt).toHaveBeenCalledOnce();
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

	it("injects agent and model into session.command", async () => {
		const command = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync: vi.fn(), prompt: vi.fn(), command },
		} as unknown as KiloClient;

		const wrapped = withPromptOptions(client, {
			getAgent: () => "ask",
			getModel: () => ({ providerID: "kilo", modelID: "auto" }),
			getVariant: () => "low",
		});
		await wrapped.session.command({
			sessionID: "s1",
			command: "init",
			arguments: "",
		});

		expect(command).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionID: "s1",
				command: "init",
				agent: "ask",
				model: "kilo/auto",
				variant: "low",
			}),
		);
	});

	it("rewrites a known slash prompt onto session.command", async () => {
		const command = vi.fn(async () => undefined);
		const prompt = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync: vi.fn(), prompt, command },
		} as unknown as KiloClient;

		const wrapped = withPromptOptions(client, {
			getAgent: () => "code",
			getKnownCommandNames: () => ["init", "compact"],
		});
		await wrapped.session.prompt({
			sessionID: "s1",
			parts: [{ type: "text", text: "/init write AGENTS.md" }],
		});

		expect(prompt).not.toHaveBeenCalled();
		expect(command).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionID: "s1",
				command: "init",
				arguments: "write AGENTS.md",
				agent: "code",
			}),
		);
	});

	it("rewrites slash promptAsync with a command model string", async () => {
		const command = vi.fn(async () => undefined);
		const promptAsync = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync, prompt: vi.fn(), command },
		} as unknown as KiloClient;

		const wrapped = withPromptOptions(client, {
			getAgent: () => "code",
			getModel: () => ({ providerID: "kilo", modelID: "auto" }),
			getKnownCommandNames: () => ["coss"],
		});
		await wrapped.session.promptAsync({
			sessionID: "s1",
			parts: [{ type: "text", text: "/coss what is this skill" }],
		});

		expect(promptAsync).not.toHaveBeenCalled();
		expect(command).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionID: "s1",
				command: "coss",
				arguments: "what is this skill",
				agent: "code",
				model: "kilo/auto",
			}),
		);
	});

	it("returns from promptAsync before session.command finishes", async () => {
		let release!: () => void;
		const command = vi.fn(
			() =>
				new Promise<undefined>((resolve) => {
					release = () => resolve(undefined);
				}),
		);
		const promptAsync = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync, prompt: vi.fn(), command },
		} as unknown as KiloClient;

		const wrapped = withPromptOptions(client, {
			getKnownCommandNames: () => ["coss"],
		});
		const pending = wrapped.session.promptAsync({
			sessionID: "s1",
			parts: [{ type: "text", text: "/coss what is this skill" }],
		});
		await vi.waitFor(() => expect(command).toHaveBeenCalledOnce());
		await expect(pending).resolves.toBeUndefined();
		release();
	});

	it("leaves unknown or non-slash prompts on session.prompt", async () => {
		const command = vi.fn(async () => undefined);
		const prompt = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync: vi.fn(), prompt, command },
		} as unknown as KiloClient;

		const wrapped = withPromptOptions(client, {
			getKnownCommandNames: () => ["init"],
		});
		await wrapped.session.prompt({
			sessionID: "s1",
			parts: [{ type: "text", text: "hello" }],
		});

		expect(command).not.toHaveBeenCalled();
		expect(prompt).toHaveBeenCalledOnce();
	});

	it("asks Kilo to wait for slow snapshots instead of prompting on every send path", async () => {
		const prompt = vi.fn(async () => undefined);
		const promptAsync = vi.fn(async () => undefined);
		const command = vi.fn(async () => undefined);
		const client = {
			session: { promptAsync, prompt, command },
		} as unknown as KiloClient;
		const wrapped = withPromptOptions(client, { getKnownCommandNames: () => ["init"] });

		await wrapped.session.prompt({ sessionID: "s1", parts: [{ type: "text", text: "hi" }] });
		await wrapped.session.promptAsync({ sessionID: "s1", parts: [{ type: "text", text: "hi" }] });
		await wrapped.session.command({ sessionID: "s1", command: "init", arguments: "" });
		await wrapped.session.prompt({ sessionID: "s1", parts: [{ type: "text", text: "/init x" }] });

		const waits = expect.objectContaining({ snapshotInitialization: "wait" });
		expect(prompt).toHaveBeenCalledWith(waits);
		expect(promptAsync).toHaveBeenCalledWith(waits);
		expect(command).toHaveBeenNthCalledWith(1, waits);
		expect(command).toHaveBeenNthCalledWith(2, waits);
	});
});
