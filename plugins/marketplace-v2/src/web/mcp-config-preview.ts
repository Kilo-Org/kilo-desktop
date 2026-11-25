import type { Mcp } from "@opencode/schema/mcp";

/**
 * Shows the MCP server config Kilo v2 will write, so the install dialog says
 * what the user is authorising before they confirm. An item's content is v2's
 * own preview of the entry (`kilocode.marketplace` preview: a pretty-printed
 * `Mcp.ServerConfig` with secret parameters `[redacted]` and the others left
 * as `{{key}}` placeholders); this fills in the values entered so far. Every
 * setting the command or address summary does not cover is listed, and
 * content that is no server config is shown in full, so no catalog-supplied
 * setting is hidden.
 */

type Entries = Array<[string, string]>;

export type McpConfigPreview =
	| { kind: "local"; commandLine: string; cwd?: string; environment: Entries; settings: Entries }
	| { kind: "remote"; url: string; headers: Entries; settings: Entries }
	| { kind: "raw"; text: string };

/** What v2's preview writes in place of a nonempty secret parameter. */
const REDACTED = "[redacted]";
const PLACEHOLDER = /\{\{([^{}]+)\}\}/g;
const SHELL_SAFE = /^[\w@%+=:,./-]+$/;

export function mcpConfigPreview(
	content: string,
	parameters: Readonly<Record<string, string>>,
): McpConfigPreview {
	let parsed: unknown;
	try {
		parsed = JSON.parse(content, (_key, value: unknown) =>
			typeof value === "string" ? fill(value, parameters) : value,
		);
	} catch {
		return { kind: "raw", text: content };
	}
	return isServerConfig(parsed)
		? summarize(parsed)
		: { kind: "raw", text: JSON.stringify(parsed, null, 2) };
}

/**
 * The parameters v2 treats as secret. The shared contract carries no
 * `Parameter.secret` yet (step 29), but v2's preview redacts every secret
 * parameter while leaving the others as placeholders, so a parameter whose
 * placeholder is gone from a preview that redacted something is a secret one.
 */
export function secretParameterKeys(content: string, keys: readonly string[]): Set<string> {
	if (!content.includes(REDACTED)) return new Set();
	return new Set(keys.filter((key) => !content.includes(`{{${key}}}`)));
}

function fill(text: string, parameters: Readonly<Record<string, string>>): string {
	return text.replace(
		PLACEHOLDER,
		(placeholder, key: string) => parameters[key]?.trim() || placeholder,
	);
}

function summarize(config: Mcp.ServerConfig): McpConfigPreview {
	if (config.type === "local") {
		const { type: _type, command, cwd, environment, ...settings } = config;
		return {
			kind: "local",
			commandLine: command.map(shellQuote).join(" "),
			...(cwd === undefined ? {} : { cwd }),
			environment: Object.entries(environment ?? {}),
			settings: settingEntries(settings),
		};
	}
	const { type: _type, url, headers, ...settings } = config;
	return {
		kind: "remote",
		url,
		headers: Object.entries(headers ?? {}),
		settings: settingEntries(settings),
	};
}

function settingEntries(settings: object): Entries {
	return Object.entries(settings).map(([key, value]) => [key, JSON.stringify(value)]);
}

function isServerConfig(value: unknown): value is Mcp.ServerConfig {
	if (!isRecord(value)) return false;
	if (value.type === "local") {
		return (
			isStringArray(value.command) &&
			value.command.length > 0 &&
			(value.cwd === undefined || typeof value.cwd === "string") &&
			isOptionalStringRecord(value.environment)
		);
	}
	return (
		value.type === "remote" &&
		typeof value.url === "string" &&
		isOptionalStringRecord(value.headers)
	);
}

function shellQuote(arg: string): string {
	return SHELL_SAFE.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`;
}

function isOptionalStringRecord(value: unknown): boolean {
	return (
		value === undefined ||
		(isRecord(value) && Object.values(value).every((entry) => typeof entry === "string"))
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}
