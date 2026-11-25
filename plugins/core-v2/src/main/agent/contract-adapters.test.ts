import { describe, expect, it } from "vitest";

import {
	mcpServerFromContract,
	permissionRulesFromContract,
	providerEntryFromContract,
} from "./contract-adapters";

describe("the shared contracts' Kilo entries, as Kilo v2's", () => {
	it("an MCP server source's entry: enabled, timeout and OAuth in v2's names", () => {
		expect(
			mcpServerFromContract({
				type: "local",
				command: ["acme", "--stdio"],
				environment: { A: "1" },
				enabled: false,
				timeout: 500,
			}),
		).toEqual({
			type: "local",
			command: ["acme", "--stdio"],
			environment: { A: "1" },
			disabled: true,
			timeout: { startup: 500, catalog: 500, execution: 500 },
		});
		expect(
			mcpServerFromContract({
				type: "remote",
				url: "https://mcp.test",
				oauth: { clientId: "id", callbackPort: 9000 },
			}),
		).toEqual({
			type: "remote",
			url: "https://mcp.test",
			oauth: { client_id: "id", callback_port: 9000 },
		});
		expect(
			mcpServerFromContract({ type: "remote", url: "https://mcp.test", oauth: false }),
		).toEqual({ type: "remote", url: "https://mcp.test", oauth: false });
	});

	it("the local model server's AI provider entry: package, settings, headers and model capabilities", () => {
		expect(
			providerEntryFromContract({
				npm: "@ai-sdk/openai-compatible",
				name: "Local model server",
				options: {
					baseURL: "http://127.0.0.1:43123/v1",
					headers: { Authorization: "Bearer {env:KEY}" },
				},
				models: {
					qwen: {
						name: "Qwen",
						modalities: { input: ["text"], output: ["text"] },
						tool_call: true,
						reasoning: false,
						limit: { context: 32768, output: 4096 },
						cost: { input: 1, output: 2, cache_read: 0.5 },
					},
				},
			}),
		).toEqual({
			package: "@ai-sdk/openai-compatible",
			name: "Local model server",
			settings: { baseURL: "http://127.0.0.1:43123/v1" },
			headers: { Authorization: "Bearer {env:KEY}" },
			models: {
				qwen: {
					name: "Qwen",
					capabilities: {
						tools: true,
						input: ["text"],
						output: ["text"],
						reasoning: { supported: false },
					},
					limit: { context: 32768, output: 4096 },
					cost: { input: 1, output: 2, cache: { read: 0.5 } },
				},
			},
		});
		expect(providerEntryFromContract({ api: "https://api.test/v1", env: ["KEY"] })).toEqual({
			env: ["KEY"],
			settings: { baseURL: "https://api.test/v1" },
		});
	});

	it("permission rules: permission, pattern and action as v2's action, resource and effect", () => {
		expect(
			permissionRulesFromContract([
				{ permission: "external_directory", pattern: "/repo/*", action: "allow" },
			]),
		).toEqual([{ action: "external_directory", resource: "/repo/*", effect: "allow" }]);
	});
});
