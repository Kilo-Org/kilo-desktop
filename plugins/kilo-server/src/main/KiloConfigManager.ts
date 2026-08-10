import { readFile, rename, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

import type { McpServerInfo, McpTransport } from "../contracts/schemas.js";

/**
 * The shape of a single MCP entry as stored in kilo.json[c].
 * This maps the internal `McpServerInfo` to Kilo's native config format.
 *
 * `_managedBy` is an owner marker: entries with this field are managed
 * automatically by an Anaconda Desktop feature and should not be treated
 * as user-authored config. Unknown-to-Kilo keys are preserved on read so
 * they survive our own read-modify-write cycles.
 */
interface KiloMcpConfigEntry {
	type: string;
	url?: string;
	headers?: Record<string, string>;
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	enabled?: boolean;
	_managedBy?: string;
}

/** The relevant subset of Kilo's config file we read and write. */
interface KiloConfigFile {
	mcp?: Record<string, KiloMcpConfigEntry>;
	[key: string]: unknown;
}

export interface KiloConfigManagerOptions {
	/** The XDG_CONFIG_HOME directory for the Kilo server. */
	readonly configHome: string;
}

/** Config file basenames Kilo recognizes, in resolution order. */
const CONFIG_FILENAMES = ["kilo.jsonc", "kilo.json"] as const;

/** The extension to use when creating a new file (matches Kilo's own default). */
const DEFAULT_NEW_FILENAME = "kilo.jsonc";

/**
 * Manages the `mcp` section of Kilo's global config file.
 *
 * Kilo reads its config from `${XDG_CONFIG_HOME}/kilo/kilo.jsonc`
 * (preferred) or `kilo.json`. This class resolves whichever exists on
 * every read, so a user who has `kilo.jsonc` sees their entries there
 * without duplication in a separate `kilo.json`. Entries are merged
 * without clobbering unrelated top-level keys.
 *
 * Reading is JSONC-tolerant (strips `//` line and `/* ... *\/` block
 * comments before `JSON.parse`), so a user's hand-edited `.jsonc` works.
 * Writing produces plain JSON, which is valid JSONC — comments in the
 * original file are lost. Callers that need comment preservation should
 * use a full JSONC editor instead.
 */
export class KiloConfigManager {
	readonly #configDir: string;

	constructor(options: KiloConfigManagerOptions) {
		this.#configDir = path.join(options.configHome, "kilo");
	}

	/** The directory containing the managed config file. */
	get configDir(): string {
		return this.#configDir;
	}

	/** Read all MCP entries from the config file. */
	async list(): Promise<McpServerInfo[]> {
		const config = await this.#readConfig();
		const mcpSection = config.mcp ?? {};
		const entries: McpServerInfo[] = [];
		for (const [id, entry] of Object.entries(mcpSection)) {
			const transport = this.#entryToTransport(entry);
			if (transport) {
				entries.push({
					id,
					scope: "global",
					transport,
					enabled: entry.enabled !== false,
				});
			}
		}
		return entries;
	}

	/**
	 * Save or update an MCP entry. Merges without clobbering unrelated keys.
	 *
	 * @param managedBy Optional owner tag written as `_managedBy`. Use for
	 * entries managed automatically by a feature (e.g. `"anaconda-desktop"`)
	 * so future versions can identify and clean up stale entries.
	 */
	async save(
		id: string,
		transport: McpTransport,
		enabled: boolean,
		managedBy?: string,
	): Promise<void> {
		const { config, targetPath } = await this.#readConfigWithPath();
		if (!config.mcp) config.mcp = {};
		config.mcp[id] = this.#transportToEntry(transport, enabled, managedBy);
		await this.#writeConfig(targetPath, config);
	}

	/** Remove an MCP entry by id. No-op if the entry does not exist. */
	async remove(id: string): Promise<void> {
		const { config, targetPath } = await this.#readConfigWithPath();
		if (!config.mcp?.[id]) return;
		delete config.mcp[id];
		await this.#writeConfig(targetPath, config);
	}

	/** Set the enabled state of an existing MCP entry. No-op if not found. */
	async setEnabled(id: string, enabled: boolean): Promise<void> {
		const { config, targetPath } = await this.#readConfigWithPath();
		const entry = config.mcp?.[id];
		if (!entry) return;
		entry.enabled = enabled;
		await this.#writeConfig(targetPath, config);
	}

	async #readConfig(): Promise<KiloConfigFile> {
		return (await this.#readConfigWithPath()).config;
	}

	async #readConfigWithPath(): Promise<{
		config: KiloConfigFile;
		targetPath: string;
	}> {
		const existing = await this.#findExistingConfig();
		if (!existing) {
			// No file yet — create as kilo.jsonc so it stays consistent with
			// Kilo's own file convention.
			return { config: {}, targetPath: path.join(this.#configDir, DEFAULT_NEW_FILENAME) };
		}
		try {
			const raw = await readFile(existing, "utf-8");
			const parsed: unknown = JSON.parse(stripJsoncComments(raw));
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				return { config: {}, targetPath: existing };
			}
			return { config: parsed as KiloConfigFile, targetPath: existing };
		} catch (error: unknown) {
			// Malformed JSONC: refuse to overwrite the user's config file — a
			// subsequent write on {} would clobber every unrelated top-level key.
			// Move the corrupt file aside (best-effort) and surface the error.
			if (error instanceof SyntaxError) {
				const backupPath = `${existing}.corrupt-${Date.now()}`;
				await rename(existing, backupPath).catch(() => undefined);
				throw new Error(
					`Kilo config file at "${existing}" is not valid JSON/JSONC; moved to "${backupPath}". ` +
						"Refusing to overwrite to prevent data loss.",
					{ cause: error },
				);
			}
			throw error;
		}
	}

	/**
	 * Find the config file Kilo would read. Prefers `kilo.jsonc`, falls
	 * back to `kilo.json`. Returns `null` if neither exists.
	 */
	async #findExistingConfig(): Promise<string | null> {
		for (const name of CONFIG_FILENAMES) {
			const candidate = path.join(this.#configDir, name);
			try {
				const s = await stat(candidate);
				if (s.isFile()) return candidate;
			} catch {
				// missing — try next
			}
		}
		return null;
	}

	async #writeConfig(targetPath: string, config: KiloConfigFile): Promise<void> {
		await mkdir(path.dirname(targetPath), { recursive: true });
		const content = JSON.stringify(config, null, "\t") + "\n";
		await writeFile(targetPath, content, "utf-8");
	}

	#transportToEntry(
		transport: McpTransport,
		enabled: boolean,
		managedBy?: string,
	): KiloMcpConfigEntry {
		if (transport.type === "remote") {
			const entry: KiloMcpConfigEntry = {
				type: "remote",
				url: transport.url,
				enabled,
			};
			if (transport.headers && Object.keys(transport.headers).length > 0) {
				entry.headers = transport.headers;
			}
			if (managedBy) entry._managedBy = managedBy;
			return entry;
		}
		const entry: KiloMcpConfigEntry = {
			type: "stdio",
			command: transport.command,
			enabled,
		};
		if (transport.args && transport.args.length > 0) {
			entry.args = transport.args;
		}
		if (transport.env && Object.keys(transport.env).length > 0) {
			entry.env = transport.env;
		}
		if (managedBy) entry._managedBy = managedBy;
		return entry;
	}

	#entryToTransport(entry: KiloMcpConfigEntry): McpTransport | null {
		if (entry.type === "remote" && entry.url) {
			return {
				type: "remote",
				url: entry.url,
				...(entry.headers ? { headers: entry.headers } : {}),
			};
		}
		if (entry.type === "stdio" && entry.command) {
			return {
				type: "stdio",
				command: entry.command,
				...(entry.args ? { args: entry.args } : {}),
				...(entry.env ? { env: entry.env } : {}),
			};
		}
		return null;
	}
}

/**
 * Strip `//` line comments and `/* ... *\/` block comments from a JSONC
 * string, respecting string literals. Trailing commas are NOT handled —
 * a `SyntaxError` from a malformed file surfaces to the caller, which
 * moves the file aside rather than clobbering it.
 */
function stripJsoncComments(text: string): string {
	let result = "";
	let inString = false;
	let escaped = false;
	let i = 0;
	while (i < text.length) {
		const c = text[i]!;
		if (inString) {
			result += c;
			if (escaped) {
				escaped = false;
			} else if (c === "\\") {
				escaped = true;
			} else if (c === '"') {
				inString = false;
			}
			i++;
			continue;
		}
		if (c === '"') {
			inString = true;
			result += c;
			i++;
			continue;
		}
		if (c === "/" && text[i + 1] === "/") {
			// Line comment — skip until newline (preserve the newline itself
			// so line numbers in errors stay stable).
			i += 2;
			while (i < text.length && text[i] !== "\n") i++;
			continue;
		}
		if (c === "/" && text[i + 1] === "*") {
			// Block comment — skip through the terminator.
			i += 2;
			while (i + 1 < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
			i += 2;
			continue;
		}
		result += c;
		i++;
	}
	return result;
}
