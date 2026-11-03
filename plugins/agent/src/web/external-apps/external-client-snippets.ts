/** Name a pasted config gives Desktop's MCP server inside the client. */
const SERVER_NAME = "kilo-desktop";

export type ExternalClientKind =
	| "generic"
	| "cursor"
	| "claude-code"
	| "codex"
	| "vscode"
	| "claude-desktop";

export interface ExternalClientSetup {
	readonly kind: ExternalClientKind;
	/** Label in the client picker. */
	readonly label: string;
	/** Where the snippet goes, shown above it. */
	readonly description: string;
	readonly code: string;
}

/** Picker order; `generic` is the default so users first see app-agnostic settings. */
export const EXTERNAL_CLIENT_KINDS: readonly ExternalClientKind[] = [
	"generic",
	"cursor",
	"claude-code",
	"codex",
	"vscode",
	"claude-desktop",
];

/** Setup instructions for one MCP client, for a paired app's token. */
export function externalClientSetup(
	kind: ExternalClientKind,
	url: string,
	token: string,
): ExternalClientSetup {
	const authorization = `Bearer ${token}`;
	switch (kind) {
		case "generic":
			return {
				kind,
				label: "Any MCP client",
				description:
					"Add an MCP server with these settings. Apps may call it a remote, HTTP or Streamable HTTP server.",
				code: [
					"Transport: Streamable HTTP",
					`URL: ${url}`,
					`Header: Authorization: ${authorization}`,
				].join("\n"),
			};
		case "cursor":
			return {
				kind,
				label: "Cursor",
				description: "Add to ~/.cursor/mcp.json.",
				code: json({
					mcpServers: { [SERVER_NAME]: { url, headers: { Authorization: authorization } } },
				}),
			};
		case "claude-code":
			return {
				kind,
				label: "Claude Code",
				description: "Run in a terminal.",
				code: `claude mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: ${authorization}"`,
			};
		case "codex":
			return {
				kind,
				label: "Codex",
				description:
					"Add to ~/.codex/config.toml (shared by the Codex CLI, IDE extension and app).",
				code: [
					`[mcp_servers.${SERVER_NAME}]`,
					`url = "${url}"`,
					`http_headers = { "Authorization" = "${authorization}" }`,
				].join("\n"),
			};
		case "vscode":
			return {
				kind,
				label: "VS Code",
				description: "Add to .vscode/mcp.json or your user MCP configuration.",
				code: json({
					servers: {
						[SERVER_NAME]: { type: "http", url, headers: { Authorization: authorization } },
					},
				}),
			};
		case "claude-desktop":
			return {
				kind,
				label: "Claude Desktop",
				description:
					"Add to claude_desktop_config.json. Uses the third-party mcp-remote package (requires Node.js), since Claude Desktop only starts local servers.",
				code: json({
					mcpServers: {
						[SERVER_NAME]: {
							command: "npx",
							args: ["-y", "mcp-remote", url, "--header", `Authorization:${authorization}`],
						},
					},
				}),
			};
	}
}

function json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}
