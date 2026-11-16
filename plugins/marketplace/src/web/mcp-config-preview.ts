/**
 * Renders the MCP entry Kilo will write for a catalog template, so the install dialog can show
 * what the user is authorising before they confirm. Substitution and normalization mirror Kilo's
 * marketplace installer (`buildMcpEntry`); anything the summary cannot represent falls back to the
 * full configuration so no catalog-supplied setting is hidden.
 */

export type McpConfigPreview =
	| { kind: "local"; commandLine: string; environment: Array<[string, string]> }
	| { kind: "remote"; url: string; headers: Array<[string, string]> }
	| { kind: "raw"; text: string };

const SECRET_MASK = "••••••";
const LOCAL_KEYS = new Set(["type", "command", "environment", "enabled", "timeout"]);
const REMOTE_KEYS = new Set(["type", "url", "headers", "enabled", "timeout"]);
const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

export function mcpConfigPreview(
	content: string,
	parameters: Record<string, string>,
	secretKeys: ReadonlySet<string>,
): McpConfigPreview {
	const masked = Object.fromEntries(
		Object.entries(parameters).map(([key, value]) => [
			key,
			secretKeys.has(key) && value ? SECRET_MASK : value,
		]),
	);
	const substituted = substituteParams(content, masked);
	let parsed: unknown;
	try {
		parsed = JSON.parse(substituted);
	} catch {
		return { kind: "raw", text: substituted };
	}
	if (!isRecord(parsed)) return { kind: "raw", text: substituted };
	const entry = normalizeMcpEntry(parsed);
	return summarize(entry) ?? { kind: "raw", text: JSON.stringify(entry, null, 2) };
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

function substituteParams(template: string, parameters: Record<string, string>): string {
	return Object.entries(parameters).reduce((text, [key, value]) => {
		const escaped = escapeJsonValue(value);
		return text.replaceAll(`{{${key}}}`, escaped).replaceAll(`\${${key}}`, escaped);
	}, template);
}

function escapeJsonValue(raw: string): string {
	return raw
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r")
		.replace(/\t/g, "\\t");
}

function normalizeMcpEntry(raw: Record<string, unknown>): Record<string, unknown> {
	if (raw.type === "local" || raw.type === "remote") return raw;
	if (typeof raw.url === "string") {
		const entry: Record<string, unknown> = { type: "remote", url: raw.url };
		if (raw.headers && typeof raw.headers === "object") entry.headers = raw.headers;
		for (const key of ["enabled", "timeout", "oauth"]) {
			if (key in raw) entry[key] = raw[key];
		}
		return entry;
	}
	if (typeof raw.command === "string") {
		const args = Array.isArray(raw.args)
			? raw.args.filter((arg): arg is string => typeof arg === "string")
			: [];
		const entry: Record<string, unknown> = { type: "local", command: [raw.command, ...args] };
		if (raw.env && typeof raw.env === "object" && Object.keys(raw.env).length > 0) {
			entry.environment = raw.env;
		}
		for (const key of ["enabled", "timeout"]) {
			if (key in raw) entry[key] = raw[key];
		}
		return entry;
	}
	return raw;
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
