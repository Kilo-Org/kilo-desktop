import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { McpServerInfo, McpTransport } from "../contracts/schemas.js";

/**
 * The shape of a single MCP entry as stored in kilo.json.
 * This maps the internal `McpServerInfo` to Kilo's native config format.
 *
 * `_managedBy` is an owner marker: entries with this field are managed
 * automatically by an Anaconda Desktop feature and should not be treated
 * as user-authored config. Unknown-to-Kilo keys are preserved on read
 * so they survive our own read-modify-write cycles.
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

/** The relevant subset of kilo.json we read and write. */
interface KiloConfigFile {
	mcp?: Record<string, KiloMcpConfigEntry>;
	[key: string]: unknown;
}

export interface KiloConfigManagerOptions {
	/** The XDG_CONFIG_HOME directory for the Kilo server. */
	readonly configHome: string;
}

/**
 * Manages the `mcp` section of Kilo's global config file.
 *
 * Kilo reads its config from `${XDG_CONFIG_HOME}/kilo/kilo.json`.
 * This class merges MCP entries without clobbering unrelated keys.
 */
export class KiloConfigManager {
	readonly #configPath: string;

	constructor(options: KiloConfigManagerOptions) {
		this.#configPath = path.join(options.configHome, "kilo", "kilo.json");
	}

	/** The path to the managed kilo.json file. */
	get configPath(): string {
		return this.#configPath;
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
	 * so future versions can identify and clean up stale entries after downgrade.
	 */
	async save(
		id: string,
		transport: McpTransport,
		enabled: boolean,
		managedBy?: string,
	): Promise<void> {
		const config = await this.#readConfig();
		if (!config.mcp) config.mcp = {};
		config.mcp[id] = this.#transportToEntry(transport, enabled, managedBy);
		await this.#writeConfig(config);
	}

	/** Remove an MCP entry by id. No-op if the entry does not exist. */
	async remove(id: string): Promise<void> {
		const config = await this.#readConfig();
		if (!config.mcp?.[id]) return;
		delete config.mcp[id];
		await this.#writeConfig(config);
	}

	/** Set the enabled state of an existing MCP entry. No-op if entry not found. */
	async setEnabled(id: string, enabled: boolean): Promise<void> {
		const config = await this.#readConfig();
		const entry = config.mcp?.[id];
		if (!entry) return;
		entry.enabled = enabled;
		await this.#writeConfig(config);
	}

	async #readConfig(): Promise<KiloConfigFile> {
		try {
			const content = await readFile(this.#configPath, "utf-8");
			const parsed: unknown = JSON.parse(content);
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
				return {};
			}
			return parsed as KiloConfigFile;
		} catch (error: unknown) {
			if (isNodeError(error) && error.code === "ENOENT") {
				return {};
			}
			// Malformed JSON: refuse to overwrite the user's config file — a subsequent
			// write on {} would clobber every unrelated top-level key. Move the corrupt
			// file aside (best-effort) and surface the error so callers can report it.
			if (error instanceof SyntaxError) {
				const backupPath = `${this.#configPath}.corrupt-${Date.now()}`;
				await rename(this.#configPath, backupPath).catch(() => undefined);
				throw new Error(
					`Kilo config file at "${this.#configPath}" is not valid JSON; moved to "${backupPath}". ` +
						"Refusing to overwrite to prevent data loss.",
					{ cause: error },
				);
			}
			throw error;
		}
	}

	async #writeConfig(config: KiloConfigFile): Promise<void> {
		const dir = path.dirname(this.#configPath);
		await mkdir(dir, { recursive: true });
		const content = JSON.stringify(config, null, "\t") + "\n";
		await writeFile(this.#configPath, content, "utf-8");
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}
