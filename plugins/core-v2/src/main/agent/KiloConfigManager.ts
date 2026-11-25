import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { writeFile as atomicWriteFile } from "atomically";
import {
	applyEdits,
	findNodeAtLocation,
	modify,
	parseTree,
	printParseErrorCode,
} from "jsonc-parser";
import isEqual from "lodash/isEqual.js";

import type { JSONPath, Node, ParseError } from "jsonc-parser";
import type { KiloLogger } from "./KiloServerManager.js";

import { kiloConfigWrites, type ConfigWriteQueue } from "../config-writes.js";
import type { KiloAgent, KiloCommand, KiloMcpServer, KiloProvider } from "./kilo-config-types.js";

/** Desktop's own Kilo v2 global config file (`KILO2_CONFIG_DIR` replaces v2's global config directory). */
export const KILO_V2_CONFIG_FILENAME = "kilo2.jsonc";
export const OWNERSHIP_SIDECAR_FILENAME = ".kilo-desktop-ownership.json";
const SIDECAR_SCHEMA_VERSION = 1;

/** The keyed sections of Kilo's config Desktop writes entries into, by their v2 path, and their entries. */
export interface KiloConfigSections {
	readonly "mcp.servers": KiloMcpServer;
	readonly providers: KiloProvider;
	readonly agents: KiloAgent;
	readonly commands: KiloCommand;
}
export type KiloConfigSection = keyof KiloConfigSections;

export interface KiloEntryOptions {
	/** Takes over an existing entry Desktop doesn't own when it says so. */
	readonly adoptExisting?: (current: unknown) => boolean;
}

export type KiloConfigMutationOutcome =
	| { readonly kind: "written"; readonly reason: "created" | "updated" }
	| { readonly kind: "removed"; readonly reason: "explicit" }
	| {
			readonly kind: "skipped";
			readonly reason:
				| "entry-not-owned"
				| "owned-by-other-source"
				| "up-to-date"
				| "nothing-to-remove";
	  }
	| { readonly kind: "skipped-error"; readonly reason: string };

/** Which source owns each entry Desktop wrote, keyed `<section>:<name>`. */
interface Sidecar {
	readonly version: number;
	readonly owners: Readonly<Record<string, string>>;
}

const NO_OWNERSHIP: Sidecar = { version: SIDECAR_SCHEMA_VERSION, owners: {} };

function ownershipKey(section: KiloConfigSection, entryName: string): string {
	return `${section}:${entryName}`;
}

function entryLocation(section: KiloConfigSection, entryName: string): JSONPath {
	return [...section.split("."), entryName];
}

function parseSidecar(raw: string): Sidecar | undefined {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		const owners = (parsed as Record<string, unknown>).owners;
		if (!owners || typeof owners !== "object" || Array.isArray(owners)) return undefined;
		return {
			version: SIDECAR_SCHEMA_VERSION,
			owners: Object.fromEntries(
				Object.entries(owners).filter(
					(entry): entry is [string, string] => typeof entry[1] === "string",
				),
			),
		};
	} catch {
		return undefined;
	}
}

async function readSidecar(sidecarPath: string): Promise<Sidecar> {
	let raw: string;
	try {
		raw = await readFile(sidecarPath, "utf8");
	} catch {
		return NO_OWNERSHIP;
	}
	// A corrupt or unreadable sidecar means Desktop owns nothing. This is the
	// conservative choice: never overwrite an entry whose ownership is unclear.
	return parseSidecar(raw) ?? NO_OWNERSHIP;
}

async function writeSidecar(sidecarPath: string, sidecar: Sidecar): Promise<void> {
	if (Object.keys(sidecar.owners).length === 0) {
		try {
			await unlink(sidecarPath);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		return;
	}
	await atomicWriteFile(sidecarPath, `${JSON.stringify(sidecar, undefined, 2)}\n`, {
		encoding: "utf8",
	});
}

function withOwner(sidecar: Sidecar, key: string, sourceId: string | undefined): Sidecar {
	const owners = { ...sidecar.owners };
	if (sourceId === undefined) delete owners[key];
	else owners[key] = sourceId;
	return { version: SIDECAR_SCHEMA_VERSION, owners };
}

async function readExistingConfig(
	filePath: string,
): Promise<
	| { kind: "absent" }
	| { kind: "ok"; text: string; root: Node | undefined }
	| { kind: "unparseable"; reason: string }
> {
	let raw: string;
	try {
		raw = await readFile(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
		throw error;
	}
	if (raw.trim() === "") return { kind: "ok", text: raw, root: undefined };
	const errors: ParseError[] = [];
	const root = parseTree(raw, errors, { allowTrailingComma: true, disallowComments: false });
	if (errors.length > 0) {
		const detail = errors
			.slice(0, 3)
			.map((error) => `${printParseErrorCode(error.error)}@${error.offset}`)
			.join(", ");
		return { kind: "unparseable", reason: `JSONC parse error(s): ${detail}` };
	}
	if (!root || root.type !== "object") {
		return {
			kind: "unparseable",
			reason: `top-level is not a JSON object (got ${root?.type ?? "empty"})`,
		};
	}
	return { kind: "ok", text: raw, root };
}

function nodeToValue(node: Node | undefined): unknown {
	if (!node) return undefined;
	if (node.type === "object") {
		const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		for (const child of node.children ?? []) {
			if (child.type !== "property") continue;
			const [nameNode, valueNode] = child.children ?? [];
			if (!nameNode || nameNode.type !== "string" || !valueNode) continue;
			result[nameNode.value as string] = nodeToValue(valueNode);
		}
		return result;
	}
	if (node.type === "array") return (node.children ?? []).map((child) => nodeToValue(child));
	return node.value;
}

function tryApplyModification(
	text: string,
	location: JSONPath,
	value: unknown,
): { ok: true; text: string } | { ok: false; reason: string } {
	try {
		const base = text || "{}\n";
		const result = applyEdits(
			base,
			modify(base, location, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }),
		);
		return { ok: true, text: result.endsWith("\n") ? result : `${result}\n` };
	} catch (error) {
		return {
			ok: false,
			reason: `jsonc modify() failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Owns Desktop's edits of its Kilo v2 config (`kilo2.jsonc` in Desktop's
 * `KILO2_CONFIG_DIR`, which is v2's whole global config directory) and its
 * ownership sidecar. Callers give v2 entries, written as given at their v2
 * path (`mcp.servers.<name>`, `providers.<id>`, `agents.<id>`,
 * `commands.<id>`).
 *
 * Unknown entries and JSONC formatting stay user-owned; only sidecar-owned
 * entries are updated or removed, each bound to the source that first claimed
 * it. Every edit is a read-modify-write of the file, so edits run through the
 * process's one config write queue (`config-writes.ts`), shared with the
 * `kilocode.settings` RPC writes, and never lose each other's changes.
 */
export class KiloConfigManager {
	readonly #configDirectory: string;
	readonly #logger: Pick<KiloLogger, "info" | "warn" | "error">;
	readonly #writes: ConfigWriteQueue;

	constructor(
		configDirectory: string,
		logger: Pick<KiloLogger, "info" | "warn" | "error"> = {
			info() {},
			warn() {},
			error() {},
		},
		writes: ConfigWriteQueue = kiloConfigWrites,
	) {
		this.#configDirectory = configDirectory;
		this.#logger = logger;
		this.#writes = writes;
	}

	get #sidecarPath(): string {
		return path.join(this.#configDirectory, OWNERSHIP_SIDECAR_FILENAME);
	}

	setEntry<TSection extends KiloConfigSection>(
		section: TSection,
		sourceId: string,
		entryName: string,
		entry: KiloConfigSections[TSection],
		options?: KiloEntryOptions,
	): Promise<KiloConfigMutationOutcome> {
		const snapshot = structuredClone(entry);
		return this.#writes.run(() => this.#update(section, sourceId, entryName, snapshot, options));
	}

	removeEntry(
		section: KiloConfigSection,
		sourceId: string,
		entryName: string,
		options?: KiloEntryOptions,
	): Promise<KiloConfigMutationOutcome> {
		return this.#writes.run(() => this.#update(section, sourceId, entryName, undefined, options));
	}

	listOwnedEntryIds(section: KiloConfigSection, sourceId: string): Promise<readonly string[]> {
		return this.#writes.run(async () => {
			if (!sourceId.trim()) throw new Error(`${section} source id is empty`);
			const prefix = ownershipKey(section, "");
			return Object.entries((await readSidecar(this.#sidecarPath)).owners)
				.filter(([key, owner]) => key.startsWith(prefix) && owner === sourceId)
				.map(([key]) => key.slice(prefix.length));
		});
	}

	/**
	 * Writes (or with no `desired`, removes) one entry if `sourceId` owns it
	 * or may adopt it, comparing the entry with what is in the file.
	 */
	async #update(
		section: KiloConfigSection,
		sourceId: string,
		entryName: string,
		desired: unknown,
		options?: KiloEntryOptions,
	): Promise<KiloConfigMutationOutcome> {
		if (!sourceId.trim()) return { kind: "skipped-error", reason: `${section} source id is empty` };
		if (!entryName.trim()) {
			return { kind: "skipped-error", reason: `${section} entry name is empty` };
		}
		await mkdir(this.#configDirectory, { recursive: true });
		const filePath = path.join(this.#configDirectory, KILO_V2_CONFIG_FILENAME);
		const existing = await readExistingConfig(filePath);
		if (existing.kind === "unparseable") {
			this.#logger.warn(
				`Refusing to touch ${filePath}: ${existing.reason}. Fix the file or delete it.`,
			);
			return { kind: "skipped-error", reason: existing.reason };
		}
		const text = existing.kind === "ok" ? existing.text : "";
		const location = entryLocation(section, entryName);
		const root = existing.kind === "ok" ? existing.root : undefined;
		const current = root ? nodeToValue(findNodeAtLocation(root, location)) : undefined;
		const sidecar = await readSidecar(this.#sidecarPath);
		const key = ownershipKey(section, entryName);
		const owner = sidecar.owners[key];
		const ownsEntry =
			owner !== undefined || (current !== undefined && options?.adoptExisting?.(current) === true);

		if (owner !== undefined && owner !== sourceId) {
			return { kind: "skipped", reason: "owned-by-other-source" };
		}

		if (desired === undefined) {
			if (current === undefined) {
				if (owner !== undefined)
					await writeSidecar(this.#sidecarPath, withOwner(sidecar, key, undefined));
				return { kind: "skipped", reason: "nothing-to-remove" };
			}
			if (!ownsEntry) {
				this.#logger.info(
					`Leaving ${section}["${entryName}"] alone: entry is not owned by Desktop.`,
				);
				return { kind: "skipped", reason: "entry-not-owned" };
			}
			const removed = tryApplyModification(text, location, undefined);
			if (!removed.ok) return { kind: "skipped-error", reason: removed.reason };
			await atomicWriteFile(filePath, removed.text, { encoding: "utf8" });
			await writeSidecar(this.#sidecarPath, withOwner(sidecar, key, undefined));
			return { kind: "removed", reason: "explicit" };
		}

		if (current !== undefined && !ownsEntry) {
			this.#logger.info(`Leaving ${section}["${entryName}"] alone: entry is not owned by Desktop.`);
			return { kind: "skipped", reason: "entry-not-owned" };
		}
		if (owner !== undefined && isEqual(current, desired)) {
			return { kind: "skipped", reason: "up-to-date" };
		}

		const next = tryApplyModification(text, location, desired);
		if (!next.ok) return { kind: "skipped-error", reason: next.reason };
		await writeSidecar(this.#sidecarPath, withOwner(sidecar, key, sourceId));
		await atomicWriteFile(filePath, next.text, { encoding: "utf8" });
		return { kind: "written", reason: existing.kind === "absent" ? "created" : "updated" };
	}
}
