import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { writeFile as atomicWriteFile } from "atomically";
import { applyEdits, modify, parseTree, printParseErrorCode } from "jsonc-parser";
import isEqual from "lodash/isEqual.js";

import type { Node, ParseError } from "jsonc-parser";
import type { KiloLogger } from "./KiloServerManager.js";

export const KILO_CONFIG_FILENAME = "kilo.jsonc";
export const OWNERSHIP_SIDECAR_FILENAME = ".kilo-desktop-ownership.json";
const LEGACY_OWNERSHIP_SIDECAR_FILENAMES = [
	".anaconda-desktop-ownership.json",
	".anaconda-desktop-managed.json",
] as const;
const OBSOLETE_LOCAL_PROVIDER_ENTRY_NAME = "anaconda-local";
const SIDECAR_SCHEMA_VERSION = 4;

export type KiloConfigEntry = Readonly<Record<string, unknown>>;
export type KiloMcpEntry = KiloConfigEntry;
export type KiloProviderEntry = KiloConfigEntry;
export type KiloOwnedMcpEntry = {
	readonly id: string;
	readonly sourceId: string | undefined;
};
type KiloConfigSection = "mcp" | "provider";

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
		// them orphans those entries in kilo.jsonc forever.
		let { sidecar, requiresMigration } = current.result;
		for (const filename of LEGACY_OWNERSHIP_SIDECAR_FILENAMES) {
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

function readEntry(root: Node | undefined, section: KiloConfigSection, name: string): unknown {
	if (!root?.children) return undefined;
	const sectionProperty = root.children.find(
		(child) =>
			child.type === "property" &&
			child.children?.[0]?.type === "string" &&
			child.children[0].value === section,
	);
	const sectionNode = sectionProperty?.children?.[1];
	if (sectionNode?.type !== "object" || !sectionNode.children) return undefined;
	const entryProperty = sectionNode.children.find(
		(child) =>
			child.type === "property" &&
			child.children?.[0]?.type === "string" &&
			child.children[0].value === name,
	);
	return nodeToValue(entryProperty?.children?.[1]);
}

function applyModification(
	text: string,
	section: KiloConfigSection,
	entryName: string,
	value: unknown,
): string {
	let result = text || "{}\n";
	const edits = modify(result, [section, entryName], value, {
		formattingOptions: { insertSpaces: true, tabSize: 2 },
	});
	result = applyEdits(result, edits);
	return result.endsWith("\n") ? result : `${result}\n`;
}

function tryApplyModification(
	text: string,
	section: KiloConfigSection,
	entryName: string,
	value: unknown,
): { ok: true; text: string } | { ok: false; reason: string } {
	try {
		return { ok: true, text: applyModification(text, section, entryName, value) };
	} catch (error) {
		return {
			ok: false,
			reason: `jsonc modify() failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Owns serialized mutations of Desktop's Kilo config and its ownership sidecar.
 * Unknown entries and JSONC formatting remain user-owned; only sidecar-owned
 * MCP and provider entries may be updated or removed, and MCP entries may be
 * enumerated by their owning source. Each section-qualified entry is bound to
 * the source that first claimed it. Flat historical ownership records are
 * migrated as MCP ownership. The queue prevents independent features and the
 * boot-time WebMCP initialization from losing each other's writes.
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

	setMcpEntry(
		sourceId: string,
		entryName: string,
		entry: KiloMcpEntry,
		options?: { readonly adoptExisting?: (current: unknown) => boolean },
	): Promise<KiloConfigMutationOutcome> {
		const snapshot = structuredClone(entry);
		return this.#enqueue(() => this.#updateEntry("mcp", sourceId, entryName, snapshot, options));
	}

	removeMcpEntry(
		sourceId: string,
		entryName: string,
		options?: { readonly adoptExisting?: (current: unknown) => boolean },
	): Promise<KiloConfigMutationOutcome> {
		return this.#enqueue(() => this.#updateEntry("mcp", sourceId, entryName, undefined, options));
	}

	listOwnedMcpEntryIds(sourceId: string): Promise<readonly string[]> {
		return this.#enqueue(async () => {
			if (!sourceId.trim()) throw new Error("MCP source id is empty");
			const sidecarResult = await readSidecar(this.#configDirectory);
			if (sidecarResult.requiresMigration) {
				await migrateSidecar(this.#configDirectory, sidecarResult.sidecar);
			}
			const prefix = "mcp:";
			return sidecarResult.sidecar.ownedEntryKeys
				.filter((key) => key.startsWith(prefix) && sidecarResult.sidecar.owners[key] === sourceId)
				.map((key) => key.slice(prefix.length));
		});
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

	#enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.#pending.then(operation, operation);
		this.#pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	async #updateEntry(
		section: KiloConfigSection,
		sourceId: string,
		entryName: string,
		entry: KiloConfigEntry | undefined,
		options?: { readonly adoptExisting?: (current: unknown) => boolean },
	): Promise<KiloConfigMutationOutcome> {
		if (!sourceId.trim()) {
			return { kind: "skipped-error", reason: `${section} source id is empty` };
		}
		if (!entryName.trim()) {
			return { kind: "skipped-error", reason: `${section} entry name is empty` };
		}

		await mkdir(this.#configDirectory, { recursive: true });
		const filePath = path.join(this.#configDirectory, KILO_CONFIG_FILENAME);
		const sidecarPath = path.join(this.#configDirectory, OWNERSHIP_SIDECAR_FILENAME);
		const existing = await readExistingConfig(filePath);
		if (existing.kind === "unparseable") {
			this.#logger.warn(
				`Refusing to touch ${filePath}: ${existing.reason}. Fix the file or delete it.`,
			);
			return { kind: "skipped-error", reason: existing.reason };
		}

		const sidecarResult = await readSidecar(this.#configDirectory);
		const sidecar = sidecarResult.sidecar;
		if (sidecarResult.requiresMigration) {
			await migrateSidecar(this.#configDirectory, sidecar);
		}
		const root = existing.kind === "ok" ? existing.config.root : undefined;
		const text = existing.kind === "ok" ? existing.config.text : "";
		const currentEntry = readEntry(root, section, entryName);
		const key = ownershipKey(section, entryName);
		const isOwnedByDesktop = sidecar.ownedEntryKeys.includes(key);
		const owner = sidecar.owners[key];
		const canAdopt =
			!isOwnedByDesktop &&
			currentEntry !== undefined &&
			options?.adoptExisting?.(currentEntry) === true;
		const ownsEntry = isOwnedByDesktop || canAdopt;

		if (isOwnedByDesktop && owner !== undefined && owner !== sourceId) {
			return { kind: "skipped", reason: "owned-by-other-source" };
		}

		if (entry === undefined) {
			if (currentEntry === undefined) {
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
			const removed = tryApplyModification(text, section, entryName, undefined);
			if (!removed.ok) return { kind: "skipped-error", reason: removed.reason };
			await atomicWriteFile(filePath, removed.text, { encoding: "utf8" });
			await writeSidecar(sidecarPath, removeOwnership(sidecar, key));
			return { kind: "removed", reason: "explicit" };
		}

		if (currentEntry !== undefined && !ownsEntry) {
			this.#logger.info(`Leaving ${section}["${entryName}"] alone: entry is not owned by Desktop.`);
			return { kind: "skipped", reason: "entry-not-owned" };
		}
		if (isOwnedByDesktop && isEqual(currentEntry, entry)) {
			if (owner === undefined) {
				await writeSidecar(sidecarPath, assignOwnership(sidecar, key, sourceId));
			}
			return { kind: "skipped", reason: "up-to-date" };
		}

		const nextConfig = tryApplyModification(text, section, entryName, entry);
		if (!nextConfig.ok) return { kind: "skipped-error", reason: nextConfig.reason };
		await writeSidecar(sidecarPath, assignOwnership(sidecar, key, sourceId));
		await atomicWriteFile(filePath, nextConfig.text, { encoding: "utf8" });
		return {
			kind: "written",
			reason: existing.kind === "absent" ? "created" : "updated",
		};
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

		await mkdir(this.#configDirectory, { recursive: true });
		const filePath = path.join(this.#configDirectory, KILO_CONFIG_FILENAME);
		const sidecarPath = path.join(this.#configDirectory, OWNERSHIP_SIDECAR_FILENAME);
		const existing = await readExistingConfig(filePath);
		if (existing.kind === "unparseable") {
			return { kind: "skipped-error", reason: existing.reason };
		}

		const sidecarResult = await readSidecar(this.#configDirectory);
		let sidecar = sidecarResult.sidecar;
		if (sidecarResult.requiresMigration) await migrateSidecar(this.#configDirectory, sidecar);

		const root = existing.kind === "ok" ? existing.config.root : undefined;
		const originalText = existing.kind === "ok" ? existing.config.text : "";
		const currentEntry = readEntry(root, "provider", entryName);
		const legacyEntry = readEntry(root, "provider", OBSOLETE_LOCAL_PROVIDER_ENTRY_NAME);
		const key = ownershipKey("provider", entryName);
		const legacyKey = ownershipKey("provider", OBSOLETE_LOCAL_PROVIDER_ENTRY_NAME);
		const isOwned = sidecar.ownedEntryKeys.includes(key);
		const owner = sidecar.owners[key];

		if (isOwned && owner !== undefined && owner !== sourceId) {
			return { kind: "skipped", reason: "owned-by-other-source" };
		}
		if (currentEntry !== undefined && !isOwned) {
			return { kind: "skipped", reason: "entry-not-owned" };
		}

		if (isOwned && isEqual(currentEntry, entry) && legacyEntry === undefined) {
			if (owner === undefined)
				await writeSidecar(sidecarPath, assignOwnership(sidecar, key, sourceId));
			return { kind: "skipped", reason: "up-to-date" };
		}

		let nextText = originalText;
		const updated = tryApplyModification(nextText, "provider", entryName, entry);
		if (!updated.ok) return { kind: "skipped-error", reason: updated.reason };
		nextText = updated.text;
		sidecar = assignOwnership(sidecar, key, sourceId);
		if (legacyEntry !== undefined) {
			const removed = tryApplyModification(
				nextText,
				"provider",
				OBSOLETE_LOCAL_PROVIDER_ENTRY_NAME,
				undefined,
			);
			if (!removed.ok) return { kind: "skipped-error", reason: removed.reason };
			nextText = removed.text;
		}
		sidecar = removeOwnership(sidecar, legacyKey);

		await writeSidecar(sidecarPath, sidecar);
		await atomicWriteFile(filePath, nextText, { encoding: "utf8" });
		return {
			kind: "written",
			reason: existing.kind === "absent" ? "created" : "updated",
		};
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
