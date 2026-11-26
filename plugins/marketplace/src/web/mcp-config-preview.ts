/**
 * Summarises the MCP entry Kilo will write (`preview.server`, v2's
 * `Mcp.ServerConfig` with secrets already redacted by Kilo), so the install
 * dialog can show what the user is authorising before they confirm. Anything
 * the summary cannot represent falls back to the full entry so no setting is
 * hidden.
 */

export type McpConfigPreview =
	| { kind: "local"; commandLine: string; environment: Array<[string, string]> }
	| { kind: "remote"; url: string; headers: Array<[string, string]> }
	| { kind: "raw"; text: string };

const LOCAL_KEYS = new Set(["type", "command", "environment", "disabled", "timeout"]);
const REMOTE_KEYS = new Set(["type", "url", "headers", "oauth", "disabled", "timeout"]);
const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

export function mcpConfigPreview(server: string): McpConfigPreview {
	let parsed: unknown;
	try {
		parsed = JSON.parse(server);
	} catch {
		return { kind: "raw", text: server };
	}
	if (!isRecord(parsed)) return { kind: "raw", text: server };
	return summarize(parsed) ?? { kind: "raw", text: JSON.stringify(parsed, null, 2) };
}

function summarize(entry: Record<string, unknown>): McpConfigPreview | undefined {
	const keys = Object.keys(entry);
	if (entry.type === "local" && keys.every((key) => LOCAL_KEYS.has(key))) {
		const command = entry.command;
		const environment = stringEntries(entry.environment ?? {});
		if (!isStringArray(command) || command.length === 0 || !environment) return undefined;
		return { kind: "local", commandLine: command.map(shellQuote).join(" "), environment };
	}
	if (entry.type === "remote" && keys.every((key) => REMOTE_KEYS.has(key))) {
		const headers = stringEntries(entry.headers ?? {});
		if (typeof entry.url !== "string" || !headers) return undefined;
		return { kind: "remote", url: entry.url, headers };
	}
	return undefined;
}

function shellQuote(arg: string): string {
	return SHELL_SAFE.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
}

function stringEntries(value: unknown): Array<[string, string]> | undefined {
	if (!isRecord(value)) return undefined;
	const entries = Object.entries(value);
	return entries.every((entry): entry is [string, string] => typeof entry[1] === "string")
		? entries
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}
