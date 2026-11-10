import { describe, expect, it } from "vitest";

import {
	EXTERNAL_CLIENT_KINDS,
	externalClientSetup,
	type ExternalClientKind,
} from "./external-client-snippets.js";

const URL = "http://127.0.0.1:9350/mcp";
const TOKEN = "tok_123";

function code(kind: ExternalClientKind): string {
	return externalClientSetup(kind, URL, TOKEN).code;
}

describe("externalClientSetup", () => {
	it("starts the picker with generic instructions", () => {
		expect(EXTERNAL_CLIENT_KINDS[0]).toBe("generic");
		expect(EXTERNAL_CLIENT_KINDS).toEqual([
			"generic",
			"cursor",
			"claude-code",
			"codex",
			"vscode",
			"claude-desktop",
		]);
	});

	it("gives app-agnostic connection settings by default", () => {
		expect(code("generic")).toBe(
			[
				"Transport: Streamable HTTP",
				"URL: http://127.0.0.1:9350/mcp",
				"Header: Authorization: Bearer tok_123",
			].join("\n"),
		);
	});

	it("gives Cursor a Streamable HTTP server with the bearer header", () => {
		expect(JSON.parse(code("cursor"))).toEqual({
			mcpServers: {
				"kilo-desktop": {
					url: "http://127.0.0.1:9350/mcp",
					headers: { Authorization: "Bearer tok_123" },
				},
			},
		});
	});

	it("gives Claude Code a single CLI command", () => {
		expect(code("claude-code")).toBe(
			'claude mcp add --transport http kilo-desktop http://127.0.0.1:9350/mcp --header "Authorization: Bearer tok_123"',
		);
	});

	it("gives Codex a config.toml server table with a static Authorization header", () => {
		expect(code("codex")).toBe(
			[
				"[mcp_servers.kilo-desktop]",
				'url = "http://127.0.0.1:9350/mcp"',
				'http_headers = { "Authorization" = "Bearer tok_123" }',
			].join("\n"),
		);
	});

	it("gives VS Code an http server entry", () => {
		expect(JSON.parse(code("vscode"))).toEqual({
			servers: {
				"kilo-desktop": {
					type: "http",
					url: "http://127.0.0.1:9350/mcp",
					headers: { Authorization: "Bearer tok_123" },
				},
			},
		});
	});

	it("bridges stdio-only Claude Desktop through mcp-remote", () => {
		expect(JSON.parse(code("claude-desktop"))).toEqual({
			mcpServers: {
				"kilo-desktop": {
					command: "npx",
					args: [
						"-y",
						"mcp-remote",
						"http://127.0.0.1:9350/mcp",
						"--header",
						"Authorization:Bearer tok_123",
					],
				},
			},
		});
	});
});
