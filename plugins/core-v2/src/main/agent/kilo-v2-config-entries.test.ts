import { describe, expect, it } from "vitest";

import {
	normalizeV2Action,
	toV2Agent,
	toV2Command,
	toV2McpServer,
	toV2PermissionRule,
	toV2Provider,
} from "./kilo-v2-config-entries.js";

describe("Kilo v2 config entries", () => {
	describe("MCP servers", () => {
		it("turns a local server's enabled flag and timeout into v2's", () => {
			expect(
				toV2McpServer({
					type: "local",
					command: ["node", "server.js"],
					environment: { TOKEN: "x" },
					cwd: "/work",
					enabled: true,
					timeout: 5000,
				}),
			).toEqual({
				entry: {
					type: "local",
					command: ["node", "server.js"],
					environment: { TOKEN: "x" },
					cwd: "/work",
					disabled: false,
					timeout: { startup: 5000, catalog: 5000, execution: 5000 },
				},
				dropped: [],
			});
		});

		it("renames a remote server's OAuth fields to snake case", () => {
			expect(
				toV2McpServer({
					type: "remote",
					url: "https://mcp.test",
					headers: { Authorization: "Bearer x" },
					oauth: { clientId: "id", clientSecret: "s", callbackPort: 1234, redirectUri: "r" },
					enabled: false,
					codemode: false,
				}).entry,
			).toEqual({
				type: "remote",
				url: "https://mcp.test",
				headers: { Authorization: "Bearer x" },
				oauth: { client_id: "id", client_secret: "s", callback_port: 1234, redirect_uri: "r" },
				disabled: true,
				codemode: false,
			});
		});

		it("keeps OAuth turned off and v2's own fields", () => {
			expect(
				toV2McpServer({
					type: "remote",
					url: "https://mcp.test",
					oauth: false,
					disabled: true,
					timeout: { startup: 1000 },
					protocol: "auto",
				}).entry,
			).toEqual({
				type: "remote",
				url: "https://mcp.test",
				oauth: false,
				disabled: true,
				timeout: { startup: 1000 },
				protocol: "auto",
			});
		});

		it("reports fields v2 has no place for instead of writing them", () => {
			expect(toV2McpServer({ type: "local", command: ["x"], stray: 1 })).toEqual({
				entry: { type: "local", command: ["x"] },
				dropped: ["stray"],
			});
		});
	});

	describe("providers", () => {
		it("moves the local model server's package, options and model modalities", () => {
			expect(
				toV2Provider({
					npm: "@ai-sdk/openai-compatible",
					name: "Local model server",
					options: {
						baseURL: "http://127.0.0.1:43123/v1",
						headers: { Authorization: "Bearer {env:KEY}" },
					},
					models: {
						"qwen-7b": { name: "Qwen 7B", modalities: { input: ["text"], output: ["text"] } },
					},
				}),
			).toEqual({
				entry: {
					name: "Local model server",
					package: "@ai-sdk/openai-compatible",
					settings: { baseURL: "http://127.0.0.1:43123/v1" },
					headers: { Authorization: "Bearer {env:KEY}" },
					models: {
						"qwen-7b": { name: "Qwen 7B", capabilities: { input: ["text"], output: ["text"] } },
					},
				},
				dropped: [],
			});
		});

		it("translates model limits, reasoning, tools, cost and the provider's cache key", () => {
			expect(
				toV2Provider({
					api: "https://api.test/v1",
					env: ["API_KEY"],
					options: { setCacheKey: true, body: { store: false }, timeout: 1000 },
					models: {
						m: {
							id: "model-id",
							limit: { context: 128000, output: 4096.7 },
							reasoning: true,
							tool_call: false,
							temperature: true,
							cost: { input: 1, output: 2, cache_read: 0.1 },
							status: "deprecated",
							headers: { "X-Model": "m" },
							options: { reasoningEffort: "high" },
						},
					},
				}).entry,
			).toEqual({
				env: ["API_KEY"],
				settings: { timeout: 1000, baseURL: "https://api.test/v1" },
				body: { store: false },
				compatibility: { supportsPromptCacheKey: true },
				models: {
					m: {
						modelID: "model-id",
						limit: { context: 128000, output: 4096 },
						capabilities: { tools: false, temperature: true, reasoning: { supported: true } },
						cost: [{ input: 1, output: 2, cache: { read: 0.1 } }],
						disabled: true,
						headers: { "X-Model": "m" },
						settings: { reasoningEffort: "high" },
					},
				},
			});
		});

		it("splits an OpenAI-compatible model's options into settings and request body", () => {
			expect(
				toV2Provider({
					npm: "@ai-sdk/openai-compatible",
					models: { m: { options: { reasoningEffort: "low", top_k: 20 } } },
				}).entry.models,
			).toEqual({ m: { settings: { reasoningEffort: "low" }, body: { top_k: 20 } } });
		});

		it("reports provider and model fields v2 dropped", () => {
			expect(
				toV2Provider({ whitelist: ["a"], models: { m: { attachment: true } } }).dropped,
			).toEqual(["whitelist", "models.m.attachment"]);
		});
	});

	describe("agents", () => {
		it("writes an agent extension's prompt as the system prompt and its model as a selection", () => {
			expect(
				toV2Agent({
					description: "Reviews",
					prompt: "Review it.",
					mode: "subagent",
					model: "anthropic/claude-sonnet#high",
				}),
			).toEqual({
				entry: {
					description: "Reviews",
					system: "Review it.",
					mode: "subagent",
					model: { providerID: "anthropic", model: "claude-sonnet", variant: "high" },
				},
				dropped: [],
			});
		});

		it("translates disable, steps, sampling options and permissions", () => {
			expect(
				toV2Agent({
					model: "openai/gpt-5",
					variant: "low",
					disable: true,
					maxSteps: 3,
					temperature: 0.2,
					options: { seed: 1 },
					color: "#AABBCC",
					permission: { bash: "ask", edit: { "*.md": "allow", "*": "deny" } },
				}).entry,
			).toEqual({
				model: { providerID: "openai", model: "gpt-5", variant: "low" },
				disabled: true,
				steps: 3,
				request: { body: { seed: 1, temperature: 0.2 } },
				color: "#AABBCC",
				permissions: [
					{ action: "shell", resource: "*", effect: "ask" },
					{ action: "edit", resource: "*.md", effect: "allow" },
					{ action: "edit", resource: "*", effect: "deny" },
				],
			});
		});

		it("reports a model it can't parse", () => {
			expect(toV2Agent({ prompt: "x", model: "no-provider" })).toEqual({
				entry: { system: "x" },
				dropped: ["model"],
			});
		});
	});

	describe("commands", () => {
		it("writes subtask as subagent and the model as a selection", () => {
			expect(
				toV2Command({
					template: "Review $ARGUMENTS",
					description: "Review",
					agent: "reviewer",
					model: "kilo/auto",
					subtask: true,
				}),
			).toEqual({
				entry: {
					template: "Review $ARGUMENTS",
					description: "Review",
					agent: "reviewer",
					model: { providerID: "kilo", model: "auto" },
					subagent: true,
				},
				dropped: [],
			});
		});
	});

	describe("permissions", () => {
		it("names tools the way v2 does", () => {
			expect(
				["bash", "write", "patch", "apply_patch", "task", "suggest"].map(normalizeV2Action),
			).toEqual(["shell", "edit", "edit", "edit", "subagent", "suggest"]);
		});

		it("makes a rule for every resource", () => {
			expect(toV2PermissionRule("bash", "deny")).toEqual({
				action: "shell",
				resource: "*",
				effect: "deny",
			});
		});
	});
});
