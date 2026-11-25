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

import {
	toV2Agent,
	toV2Command,
	toV2McpServer,
	toV2Provider,
	type V2Translation,
} from "./kilo-v2-config-entries.js";

/** Desktop's own Kilo v2 global config file (`KILO2_CONFIG_DIR` replaces v2's global config directory). */
export const KILO_V2_CONFIG_FILENAME = "kilo2.jsonc";
export const OWNERSHIP_SIDECAR_FILENAME = ".kilo-desktop-ownership.json";
const LEGACY_OWNERSHIP_SIDECAR_FILENAMES = [
	".anaconda-desktop-ownership.json",
	".anaconda-desktop-managed.json",
] as const;
const OBSOLETE_LOCAL_PROVIDER_ENTRY_NAME = "anaconda-local";
const SIDECAR_SCHEMA_VERSION = 4;
const PERMISSIONS_KEY = "permissions";

export type KiloConfigEntry = Readonly<Record<string, unknown>>;
export type KiloMcpEntry = KiloConfigEntry;
export type KiloProviderEntry = KiloConfigEntry;
export type KiloOwnedMcpEntry = {
	readonly id: string;
	readonly sourceId: string | undefined;
};
export type KiloPermissionAction = "allow" | "ask" | "deny";
/** The sections of Kilo's config whose entries Desktop writes, each entry owned by one source. */
export type KiloConfigSection = "mcp" | "provider" | "permission" | "agent" | "command";
/** The sections whose entries are whole objects, written and pruned per source generically. */
export type KiloEntrySection = Extract<KiloConfigSection, "mcp" | "agent" | "command">;

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

interface Sidecar {
	readonly version: number;
	readonly ownedEntryKeys: readonly string[];
	readonly owners: Readonly<Record<string, string>>;
}

interface SidecarReadResult {
	readonly sidecar: Sidecar;
	readonly requiresMigration: boolean;
}

interface ExistingConfig {
	readonly text: string;
	readonly root: Node | undefined;
}

function noOwnership(): SidecarReadResult {
	return {
		sidecar: { version: SIDECAR_SCHEMA_VERSION, ownedEntryKeys: [], owners: {} },
		requiresMigration: false,
	};
}

function ownershipKey(section: KiloConfigSection, entryId: string): string {
	return `${section}:${entryId}`;
}

function sidecarFromKeys(
	keys: readonly string[],
	ownersValue: unknown,
	transformOwnerKey: (key: string) => string,
): Sidecar {
	const ownedEntryKeys = Array.from(new Set(keys));
	const ownedEntryKeySet = new Set(ownedEntryKeys);
	const owners =
		ownersValue && typeof ownersValue === "object" && !Array.isArray(ownersValue)
			? Object.fromEntries(
					Object.entries(ownersValue)
						.map(([key, owner]) => [transformOwnerKey(key), owner] as const)
						.filter(
							(entry): entry is readonly [string, string] =>
								ownedEntryKeySet.has(entry[0]) && typeof entry[1] === "string",
						),
				)
			: {};
	return {
		version: SIDECAR_SCHEMA_VERSION,
		ownedEntryKeys,
		owners,
	};
}

function parseSidecar(
	raw: string,
	flatKey: "ownedEntryIds" | "managed",
): { sidecar: Sidecar; requiresMigration: boolean } | undefined {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		const parsedRecord = parsed as Record<string, unknown>;
		const keysValue = parsedRecord.ownedEntryKeys;
		if (Array.isArray(keysValue)) {
			const keys = keysValue.filter((entry): entry is string => typeof entry === "string");
			return {
				sidecar: sidecarFromKeys(keys, parsedRecord.owners, (key) => key),
				requiresMigration: parsedRecord.version !== SIDECAR_SCHEMA_VERSION,
			};
		}
		const entryIdsValue = parsedRecord[flatKey];
		if (!Array.isArray(entryIdsValue)) return undefined;
		const ownedEntryIds = entryIdsValue.filter(
			(entry): entry is string => typeof entry === "string",
		);
		return {
			sidecar: sidecarFromKeys(
				ownedEntryIds.map((entryId) => ownershipKey("mcp", entryId)),
				parsedRecord.owners,
				(entryId) => ownershipKey("mcp", entryId),
			),
			requiresMigration: true,
		};
	} catch {
		return undefined;
	}
}

type SidecarFileRead =
	| { readonly kind: "absent" }
	| { readonly kind: "unusable" }
	| { readonly kind: "parsed"; readonly result: SidecarReadResult };

async function readSidecarFile(
	filePath: string,
	flatKey: "ownedEntryIds" | "managed",
): Promise<SidecarFileRead> {
	let raw: string;
	try {
		raw = await readFile(filePath, "utf8");
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "ENOENT"
			? { kind: "absent" }
			: { kind: "unusable" };
	}
	const result = parseSidecar(raw, flatKey);
	return result ? { kind: "parsed", result } : { kind: "unusable" };
}

function legacyFlatKey(filename: string): "ownedEntryIds" | "managed" {
	return filename.endsWith("-managed.json") ? "managed" : "ownedEntryIds";
}

/** Adds legacy-owned keys the current sidecar does not know; current owners win. */
function mergeLegacyOwnership(current: Sidecar, legacy: Sidecar): Sidecar {
	return {
		version: SIDECAR_SCHEMA_VERSION,
		ownedEntryKeys: Array.from(new Set([...current.ownedEntryKeys, ...legacy.ownedEntryKeys])),
		owners: { ...legacy.owners, ...current.owners },
	};
}

async function readSidecar(configDirectory: string): Promise<SidecarReadResult> {
	const current = await readSidecarFile(
		path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME),
		"ownedEntryIds",
	);
	// A corrupt or unreadable sidecar means Desktop owns nothing. This is the
	// conservative choice: never overwrite an entry whose ownership is unclear.
	if (current.kind === "unusable") return noOwnership();

	if (current.kind === "parsed") {
		// A legacy sidecar beside the current one comes from an older build that
		// ran after the rename (e.g. switching branches that share a profile).
		// Its entries were still written by Desktop, so fold them in; ignoring
		// them orphans those entries in the config file forever.
		let { sidecar, requiresMigration } = current.result;
		for (const filename of LEGACY_OWNERSHIP_SIDECAR_FILENAMES) {
			// In order: each legacy sidecar folds into the result of the previous one.
			// react-doctor-disable-next-line react-doctor/async-await-in-loop
			const legacy = await readSidecarFile(
				path.join(configDirectory, filename),
				legacyFlatKey(filename),
			);
			if (legacy.kind !== "parsed") continue;
			sidecar = mergeLegacyOwnership(sidecar, legacy.result.sidecar);
			requiresMigration = true;
		}
		return { sidecar, requiresMigration };
	}

	for (const filename of LEGACY_OWNERSHIP_SIDECAR_FILENAMES) {
		const legacy = await readSidecarFile(
			path.join(configDirectory, filename),
			legacyFlatKey(filename),
		);
		if (legacy.kind === "absent") continue;
		if (legacy.kind === "unusable") return noOwnership();
		return { sidecar: legacy.result.sidecar, requiresMigration: true };
	}
	return noOwnership();
}

async function writeSidecar(sidecarPath: string, sidecar: Sidecar): Promise<void> {
	if (sidecar.ownedEntryKeys.length === 0) {
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

async function migrateSidecar(configDirectory: string, sidecar: Sidecar): Promise<void> {
	const ownershipPath = path.join(configDirectory, OWNERSHIP_SIDECAR_FILENAME);
	await writeSidecar(ownershipPath, sidecar);
	await Promise.all(
		LEGACY_OWNERSHIP_SIDECAR_FILENAMES.map(async (filename) => {
			try {
				await unlink(path.join(configDirectory, filename));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}),
	);
}

async function readExistingConfig(
	filePath: string,
): Promise<
	| { kind: "absent" }
	| { kind: "ok"; config: ExistingConfig }
	| { kind: "unparseable"; reason: string }
> {
	let raw: string;
	try {
		raw = await readFile(filePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { kind: "absent" };
		throw error;
	}
	if (raw.trim() === "") return { kind: "ok", config: { text: raw, root: undefined } };
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
	return { kind: "ok", config: { text: raw, root } };
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

function readValue(root: Node | undefined, location: JSONPath): unknown {
	if (!root) return undefined;
	return nodeToValue(findNodeAtLocation(root, location));
}

function applyModification(text: string, location: JSONPath, value: unknown): string {
	let result = text || "{}\n";
	const edits = modify(result, location, value, {
		formattingOptions: { insertSpaces: true, tabSize: 2 },
	});
	result = applyEdits(result, edits);
	return result.endsWith("\n") ? result : `${result}\n`;
}

function tryApplyModification(
	text: string,
	location: JSONPath,
	value: unknown,
): { ok: true; text: string } | { ok: false; reason: string } {
	try {
		return { ok: true, text: applyModification(text, location, value) };
	} catch (error) {
		return {
			ok: false,
			reason: `jsonc modify() failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/** Where each whole-object section's entries live in the v2 file, and their v1→v2 translation. */
const ENTRY_LAYOUT: Readonly<
	Record<
		Exclude<KiloConfigSection, "permission">,
		{
			readonly location: (entryName: string) => JSONPath;
			readonly translate: (entry: KiloConfigEntry) => V2Translation;
		}
	>
> = {
	mcp: { location: (name) => ["mcp", "servers", name], translate: toV2McpServer },
	provider: { location: (name) => ["providers", name], translate: toV2Provider },
	agent: { location: (name) => ["agents", name], translate: toV2Agent },
	command: { location: (name) => ["commands", name], translate: toV2Command },
};

/** A config file and ownership sidecar read for one mutation. */
interface Loaded {
	readonly filePath: string;
	readonly sidecarPath: string;
	readonly created: boolean;
	readonly text: string;
	readonly root: Node | undefined;
	readonly sidecar: Sidecar;
}

/**
 * Owns serialized mutations of Desktop's Kilo v2 config (`kilo2.jsonc` in
 * Desktop's `KILO2_CONFIG_DIR`, which is v2's whole global config directory)
 * and its ownership sidecar. Callers describe entries in Kilo v1's shape;
 * each is translated to v2's (`kilo-v2-config-entries.ts`) and written at its
 * v2 key: `mcp.servers.<name>`, `providers.<id>`, `agents.<id>`,
 * `commands.<id>`, and for a tool permission one `{ action, resource: "*",
 * effect }` rule in the ordered `permissions` list (Desktop's is the first
 * rule for that tool on every resource; other rules are never touched).
 *
 * Unknown entries and JSONC formatting stay user-owned; only sidecar-owned
 * entries are updated or removed, compared as translated v2 entries. Sidecar
 * keys stay `section:entry` in v1 section names, so ownership recorded by
 * earlier builds carries over; each key is bound to the source that first
 * claimed it, and flat historical records migrate as MCP ownership. The
 * queue prevents independent features and the boot-time WebMCP
 * initialization from losing each other's writes.
 */
export class KiloConfigManager {
	readonly #configDirectory: string;
	readonly #logger: Pick<KiloLogger, "info" | "warn" | "error">;
	#pending: Promise<void> = Promise.resolve();

	constructor(
		configDirectory: string,
		logger: Pick<KiloLogger, "info" | "warn" | "error"> = {
			info() {},
			warn() {},
			error() {},
		},
	) {
		this.#configDirectory = configDirectory;
		this.#logger = logger;
	}

	setEntry(
		section: KiloEntrySection,
		sourceId: string,
		entryName: string,
		entry: KiloConfigEntry,
		options?: KiloEntryOptions,
	): Promise<KiloConfigMutationOutcome> {
		const snapshot = structuredClone(entry);
		return this.#enqueue(() => this.#updateEntry(section, sourceId, entryName, snapshot, options));
	}

	removeEntry(
		section: KiloEntrySection,
		sourceId: string,
		entryName: string,
		options?: KiloEntryOptions,
	): Promise<KiloConfigMutationOutcome> {
		return this.#enqueue(() => this.#updateEntry(section, sourceId, entryName, undefined, options));
	}

	listOwnedEntryIds(section: KiloEntrySection, sourceId: string): Promise<readonly string[]> {
		return this.#enqueue(async () => {
			if (!sourceId.trim()) throw new Error(`${section} source id is empty`);
			const sidecarResult = await readSidecar(this.#configDirectory);
			if (sidecarResult.requiresMigration) {
				await migrateSidecar(this.#configDirectory, sidecarResult.sidecar);
			}
			const prefix = ownershipKey(section, "");
			return sidecarResult.sidecar.ownedEntryKeys
				.filter((key) => key.startsWith(prefix) && sidecarResult.sidecar.owners[key] === sourceId)
				.map((key) => key.slice(prefix.length));
		});
	}

	setMcpEntry(
		sourceId: string,
		entryName: string,
		entry: KiloMcpEntry,
		options?: KiloEntryOptions,
	): Promise<KiloConfigMutationOutcome> {
		return this.setEntry("mcp", sourceId, entryName, entry, options);
	}

	removeMcpEntry(
		sourceId: string,
		entryName: string,
		options?: KiloEntryOptions,
	): Promise<KiloConfigMutationOutcome> {
		return this.removeEntry("mcp", sourceId, entryName, options);
	}

	async listMcpEntries(): Promise<KiloOwnedMcpEntry[]> {
		await this.#pending;
		const sidecar = (await readSidecar(this.#configDirectory)).sidecar;
		return sidecar.ownedEntryKeys.flatMap((entry) => {
			const prefix = "mcp:";
			if (!entry.startsWith(prefix)) return [];
			return [{ id: entry.slice(prefix.length), sourceId: sidecar.owners[entry] }];
		});
	}

	setProviderEntry(
		sourceId: string,
		entryName: string,
		entry: KiloProviderEntry,
	): Promise<KiloConfigMutationOutcome> {
		const snapshot = structuredClone(entry);
		return this.#enqueue(() => this.#updateEntry("provider", sourceId, entryName, snapshot));
	}

	removeProviderEntry(sourceId: string, entryName: string): Promise<KiloConfigMutationOutcome> {
		return this.#enqueue(() => this.#updateEntry("provider", sourceId, entryName, undefined));
	}

	replaceProviderEntry(
		sourceId: string,
		entryName: string,
		entry: KiloProviderEntry,
	): Promise<KiloConfigMutationOutcome> {
		const snapshot = structuredClone(entry);
		return this.#enqueue(() => this.#replaceProviderEntry(sourceId, entryName, snapshot));
	}

	/**
	 * Owns the `{ action: <the server's tool name>, resource: "*", effect }` rule; a
	 * user-authored rule for the same tool is left alone unless it already says the same.
	 */
	setPermissionEntry(
		sourceId: string,
		toolName: string,
		action: KiloPermissionAction,
	): Promise<KiloConfigMutationOutcome> {
		return this.#enqueue(() => this.#updatePermission(sourceId, toolName, action));
	}

	#enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#pending.then(operation, operation);
		this.#pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	async #load(section: KiloConfigSection): Promise<Loaded | { readonly error: string }> {
		await mkdir(this.#configDirectory, { recursive: true });
		const filePath = path.join(this.#configDirectory, KILO_V2_CONFIG_FILENAME);
		const existing = await readExistingConfig(filePath);
		if (existing.kind === "unparseable") {
			this.#logger.warn(
				`Refusing to touch ${filePath}: ${existing.reason}. Fix the file or delete it.`,
			);
			return { error: existing.reason };
		}
		const sidecarResult = await readSidecar(this.#configDirectory);
		if (sidecarResult.requiresMigration) {
			await migrateSidecar(this.#configDirectory, sidecarResult.sidecar);
		}
		const root = existing.kind === "ok" ? existing.config.root : undefined;
		if (section === "permission") {
			const rules = root && findNodeAtLocation(root, [PERMISSIONS_KEY]);
			if (rules && rules.type !== "array") {
				return { error: `"${PERMISSIONS_KEY}" in ${filePath} is not a list of rules` };
			}
		}
		return {
			filePath,
			sidecarPath: path.join(this.#configDirectory, OWNERSHIP_SIDECAR_FILENAME),
			created: existing.kind === "absent",
			text: existing.kind === "ok" ? existing.config.text : "",
			root,
			sidecar: sidecarResult.sidecar,
		};
	}

	#translate(
		section: Exclude<KiloConfigSection, "permission">,
		entryName: string,
		entry: KiloConfigEntry,
	): KiloConfigEntry {
		const { entry: translated, dropped } = ENTRY_LAYOUT[section].translate(entry);
		if (dropped.length > 0) {
			this.#logger.warn(
				`Kilo v2 has no place for ${section} "${entryName}": ${dropped.join(", ")}; left out.`,
			);
		}
		return translated;
	}

	async #updateEntry(
		section: Exclude<KiloConfigSection, "permission">,
		sourceId: string,
		entryName: string,
		entry: KiloConfigEntry | undefined,
		options?: KiloEntryOptions,
	): Promise<KiloConfigMutationOutcome> {
		if (!sourceId.trim()) {
			return { kind: "skipped-error", reason: `${section} source id is empty` };
		}
		if (!entryName.trim()) {
			return { kind: "skipped-error", reason: `${section} entry name is empty` };
		}
		const loaded = await this.#load(section);
		if ("error" in loaded) return { kind: "skipped-error", reason: loaded.error };
		const location = ENTRY_LAYOUT[section].location(entryName);
		return this.#mutate(loaded, section, entryName, {
			current: readValue(loaded.root, location),
			location,
			desired: entry && this.#translate(section, entryName, entry),
			sourceId,
			...(options ? { options } : {}),
		});
	}

	async #updatePermission(
		sourceId: string,
		toolName: string,
		effect: KiloPermissionAction,
	): Promise<KiloConfigMutationOutcome> {
		if (!sourceId.trim()) return { kind: "skipped-error", reason: "permission source id is empty" };
		if (!toolName.trim()) return { kind: "skipped-error", reason: "permission tool name is empty" };
		const loaded = await this.#load("permission");
		if ("error" in loaded) return { kind: "skipped-error", reason: loaded.error };
		const rule = { action: toolName, resource: "*", effect };
		const rules = readValue(loaded.root, [PERMISSIONS_KEY]);
		const list = Array.isArray(rules) ? rules : [];
		// Desktop's rule for a tool is the first rule for that tool on every resource.
		const index = list.findIndex(
			(candidate: unknown) =>
				typeof candidate === "object" &&
				candidate !== null &&
				(candidate as Record<string, unknown>).action === rule.action &&
				(candidate as Record<string, unknown>).resource === rule.resource,
		);
		return this.#mutate(loaded, "permission", toolName, {
			current: index === -1 ? undefined : list[index],
			location: [PERMISSIONS_KEY, index === -1 ? -1 : index],
			desired: rule,
			sourceId,
			options: { adoptExisting: (current) => isEqual(current, rule) },
		});
	}

	/**
	 * Writes or removes one entry at `location` if Desktop's `sourceId` owns it
	 * (or may adopt it), comparing the v2 entry with what is in the file.
	 */
	async #mutate(
		loaded: Loaded,
		section: KiloConfigSection,
		entryName: string,
		change: {
			readonly current: unknown;
			readonly location: JSONPath;
			readonly desired: unknown;
			readonly sourceId: string;
			readonly options?: KiloEntryOptions;
		},
	): Promise<KiloConfigMutationOutcome> {
		const { filePath, sidecarPath, sidecar, text } = loaded;
		const { current, location, desired, sourceId, options } = change;
		const key = ownershipKey(section, entryName);
		const isOwnedByDesktop = sidecar.ownedEntryKeys.includes(key);
		const owner = sidecar.owners[key];
		const canAdopt =
			!isOwnedByDesktop && current !== undefined && options?.adoptExisting?.(current) === true;
		const ownsEntry = isOwnedByDesktop || canAdopt;

		if (isOwnedByDesktop && owner !== undefined && owner !== sourceId) {
			return { kind: "skipped", reason: "owned-by-other-source" };
		}

		if (desired === undefined) {
			if (current === undefined) {
				if (isOwnedByDesktop) {
					await writeSidecar(sidecarPath, removeOwnership(sidecar, key));
				}
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
			await writeSidecar(sidecarPath, removeOwnership(sidecar, key));
			return { kind: "removed", reason: "explicit" };
		}

		if (current !== undefined && !ownsEntry) {
			this.#logger.info(`Leaving ${section}["${entryName}"] alone: entry is not owned by Desktop.`);
			return { kind: "skipped", reason: "entry-not-owned" };
		}
		if (isOwnedByDesktop && isEqual(current, desired)) {
			if (owner === undefined) {
				await writeSidecar(sidecarPath, assignOwnership(sidecar, key, sourceId));
			}
			return { kind: "skipped", reason: "up-to-date" };
		}

		const nextConfig = tryApplyModification(text, location, desired);
		if (!nextConfig.ok) return { kind: "skipped-error", reason: nextConfig.reason };
		await writeSidecar(sidecarPath, assignOwnership(sidecar, key, sourceId));
		await atomicWriteFile(filePath, nextConfig.text, { encoding: "utf8" });
		return { kind: "written", reason: loaded.created ? "created" : "updated" };
	}

	async #replaceProviderEntry(
		sourceId: string,
		entryName: string,
		entry: KiloProviderEntry,
	): Promise<KiloConfigMutationOutcome> {
		if (!sourceId.trim()) return { kind: "skipped-error", reason: "provider source id is empty" };
		if (!entryName.trim()) {
			return { kind: "skipped-error", reason: "provider entry name is empty" };
		}
		const loaded = await this.#load("provider");
		if ("error" in loaded) return { kind: "skipped-error", reason: loaded.error };
		const { location } = ENTRY_LAYOUT.provider;
		const desired = this.#translate("provider", entryName, entry);
		const currentEntry = readValue(loaded.root, location(entryName));
		const legacyLocation = location(OBSOLETE_LOCAL_PROVIDER_ENTRY_NAME);
		const legacyEntry = readValue(loaded.root, legacyLocation);
		const key = ownershipKey("provider", entryName);
		const legacyKey = ownershipKey("provider", OBSOLETE_LOCAL_PROVIDER_ENTRY_NAME);
		let sidecar = loaded.sidecar;
		const isOwned = sidecar.ownedEntryKeys.includes(key);
		const owner = sidecar.owners[key];

		if (isOwned && owner !== undefined && owner !== sourceId) {
			return { kind: "skipped", reason: "owned-by-other-source" };
		}
		if (currentEntry !== undefined && !isOwned) {
			return { kind: "skipped", reason: "entry-not-owned" };
		}

		if (isOwned && isEqual(currentEntry, desired) && legacyEntry === undefined) {
			if (owner === undefined)
				await writeSidecar(loaded.sidecarPath, assignOwnership(sidecar, key, sourceId));
			return { kind: "skipped", reason: "up-to-date" };
		}

		const updated = tryApplyModification(loaded.text, location(entryName), desired);
		if (!updated.ok) return { kind: "skipped-error", reason: updated.reason };
		let nextText = updated.text;
		sidecar = assignOwnership(sidecar, key, sourceId);
		if (legacyEntry !== undefined) {
			const removed = tryApplyModification(nextText, legacyLocation, undefined);
			if (!removed.ok) return { kind: "skipped-error", reason: removed.reason };
			nextText = removed.text;
		}
		sidecar = removeOwnership(sidecar, legacyKey);

		await writeSidecar(loaded.sidecarPath, sidecar);
		await atomicWriteFile(loaded.filePath, nextText, { encoding: "utf8" });
		return { kind: "written", reason: loaded.created ? "created" : "updated" };
	}
}

function assignOwnership(sidecar: Sidecar, key: string, sourceId: string): Sidecar {
	return {
		version: SIDECAR_SCHEMA_VERSION,
		ownedEntryKeys: Array.from(new Set([...sidecar.ownedEntryKeys, key])),
		owners: { ...sidecar.owners, [key]: sourceId },
	};
}

function removeOwnership(sidecar: Sidecar, key: string): Sidecar {
	const owners = { ...sidecar.owners };
	delete owners[key];
	return {
		version: SIDECAR_SCHEMA_VERSION,
		ownedEntryKeys: sidecar.ownedEntryKeys.filter((entry) => entry !== key),
		owners,
	};
}
