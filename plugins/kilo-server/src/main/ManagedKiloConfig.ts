import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { writeFile as atomicWriteFile } from "atomically";
import { applyEdits, modify, parseTree, printParseErrorCode } from "jsonc-parser";
import isEqual from "lodash/isEqual.js";

import type { Node, ParseError } from "jsonc-parser";
import type { KiloLogger } from "./KiloServerManager.js";

export const KILO_CONFIG_FILENAME = "kilo.jsonc";
export const MANAGED_SIDECAR_FILENAME = ".anaconda-desktop-managed.json";
const SIDECAR_SCHEMA_VERSION = 2;

export type ManagedMcpEntry = Readonly<Record<string, unknown>>;

export type ManagedMcpOutcome =
	| { readonly kind: "written"; readonly reason: "created" | "updated" }
	| { readonly kind: "removed"; readonly reason: "explicit" }
	| {
			readonly kind: "skipped";
			readonly reason:
				| "unmanaged-entry"
				| "owned-by-other-source"
				| "up-to-date"
				| "nothing-to-remove";
	  }
	| { readonly kind: "skipped-error"; readonly reason: string };

interface Sidecar {
	readonly version: number;
	readonly managed: readonly string[];
	readonly owners: Readonly<Record<string, string>>;
}

interface ExistingConfig {
	readonly text: string;
	readonly root: Node | undefined;
}

async function readSidecar(sidecarPath: string): Promise<Sidecar> {
	try {
		const raw = await readFile(sidecarPath, "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (
			parsed &&
			typeof parsed === "object" &&
			!Array.isArray(parsed) &&
			Array.isArray((parsed as Record<string, unknown>).managed)
		) {
			const managed = ((parsed as Record<string, unknown>).managed as unknown[]).filter(
				(entry): entry is string => typeof entry === "string",
			);
			const managedSet = new Set(managed);
			const ownersValue = (parsed as Record<string, unknown>).owners;
			const owners =
				ownersValue && typeof ownersValue === "object" && !Array.isArray(ownersValue)
					? Object.fromEntries(
							Object.entries(ownersValue).filter(
								(entry): entry is [string, string] =>
									managedSet.has(entry[0]) && typeof entry[1] === "string",
							),
						)
					: {};
			return {
				version: SIDECAR_SCHEMA_VERSION,
				managed,
				owners,
			};
		}
	} catch {
		// A missing or corrupt sidecar means Desktop owns nothing. This is the
		// conservative choice: never overwrite an entry whose ownership is unclear.
	}
	return { version: SIDECAR_SCHEMA_VERSION, managed: [], owners: {} };
}

async function writeSidecar(sidecarPath: string, sidecar: Sidecar): Promise<void> {
	if (sidecar.managed.length === 0) {
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

function readMcpEntry(root: Node | undefined, name: string): unknown {
	if (!root?.children) return undefined;
	const mcpProperty = root.children.find(
		(child) =>
			child.type === "property" &&
			child.children?.[0]?.type === "string" &&
			child.children[0].value === "mcp",
	);
	const mcpNode = mcpProperty?.children?.[1];
	if (mcpNode?.type !== "object" || !mcpNode.children) return undefined;
	const entryProperty = mcpNode.children.find(
		(child) =>
			child.type === "property" &&
			child.children?.[0]?.type === "string" &&
			child.children[0].value === name,
	);
	return nodeToValue(entryProperty?.children?.[1]);
}

function applyModification(text: string, entryName: string, value: unknown): string {
	let result = text || "{}\n";
	const edits = modify(result, ["mcp", entryName], value, {
		formattingOptions: { insertSpaces: true, tabSize: 2 },
	});
	result = applyEdits(result, edits);
	return result.endsWith("\n") ? result : `${result}\n`;
}

function tryApplyModification(
	text: string,
	entryName: string,
	value: unknown,
): { ok: true; text: string } | { ok: false; reason: string } {
	try {
		return { ok: true, text: applyModification(text, entryName, value) };
	} catch (error) {
		return {
			ok: false,
			reason: `jsonc modify() failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

/**
 * Owns serialized mutations of Desktop's Kilo config and its ownership sidecar.
 * Unknown entries and JSONC formatting remain user-owned; only sidecar-marked
 * MCP entries may be updated or removed, and each entry is bound to the source
 * that first claimed it. Ownerless schema-v1 entries are adopted on their next
 * successful write for backward compatibility. The queue prevents independent
 * features and the boot-time WebMCP initialization from losing each other's writes.
 */
export class ManagedKiloConfig {
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
		entry: ManagedMcpEntry,
	): Promise<ManagedMcpOutcome> {
		const snapshot = structuredClone(entry);
		return this.#enqueue(() => this.#updateMcpEntry(sourceId, entryName, snapshot));
	}

	removeMcpEntry(sourceId: string, entryName: string): Promise<ManagedMcpOutcome> {
		return this.#enqueue(() => this.#updateMcpEntry(sourceId, entryName, undefined));
	}

	#enqueue(operation: () => Promise<ManagedMcpOutcome>): Promise<ManagedMcpOutcome> {
		const result = this.#pending.then(operation, operation);
		this.#pending = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}

	async #updateMcpEntry(
		sourceId: string,
		entryName: string,
		entry: ManagedMcpEntry | undefined,
	): Promise<ManagedMcpOutcome> {
		if (!sourceId.trim()) return { kind: "skipped-error", reason: "MCP source id is empty" };
		if (!entryName.trim()) return { kind: "skipped-error", reason: "MCP entry name is empty" };

		await mkdir(this.#configDirectory, { recursive: true });
		const filePath = path.join(this.#configDirectory, KILO_CONFIG_FILENAME);
		const sidecarPath = path.join(this.#configDirectory, MANAGED_SIDECAR_FILENAME);
		const existing = await readExistingConfig(filePath);
		if (existing.kind === "unparseable") {
			this.#logger.warn(
				`Refusing to touch ${filePath}: ${existing.reason}. Fix the file or delete it.`,
			);
			return { kind: "skipped-error", reason: existing.reason };
		}

		const sidecar = await readSidecar(sidecarPath);
		const root = existing.kind === "ok" ? existing.config.root : undefined;
		const text = existing.kind === "ok" ? existing.config.text : "";
		const currentEntry = readMcpEntry(root, entryName);
		const managed = sidecar.managed.includes(entryName);
		const owner = sidecar.owners[entryName];

		if (managed && owner !== undefined && owner !== sourceId) {
			return { kind: "skipped", reason: "owned-by-other-source" };
		}

		if (entry === undefined) {
			if (currentEntry === undefined) {
				if (managed) {
					await writeSidecar(sidecarPath, removeOwnership(sidecar, entryName));
				}
				return { kind: "skipped", reason: "nothing-to-remove" };
			}
			if (!managed) {
				this.#logger.info(`Leaving mcp["${entryName}"] alone: entry is not Desktop-managed.`);
				return { kind: "skipped", reason: "unmanaged-entry" };
			}
			const removed = tryApplyModification(text, entryName, undefined);
			if (!removed.ok) return { kind: "skipped-error", reason: removed.reason };
			await atomicWriteFile(filePath, removed.text, { encoding: "utf8" });
			await writeSidecar(sidecarPath, removeOwnership(sidecar, entryName));
			return { kind: "removed", reason: "explicit" };
		}

		if (currentEntry !== undefined && !managed) {
			this.#logger.info(`Leaving mcp["${entryName}"] alone: entry is not Desktop-managed.`);
			return { kind: "skipped", reason: "unmanaged-entry" };
		}
		if (managed && isEqual(currentEntry, entry)) {
			if (owner === undefined) {
				await writeSidecar(sidecarPath, assignOwnership(sidecar, entryName, sourceId));
			}
			return { kind: "skipped", reason: "up-to-date" };
		}

		const nextConfig = tryApplyModification(text, entryName, entry);
		if (!nextConfig.ok) return { kind: "skipped-error", reason: nextConfig.reason };
		await writeSidecar(sidecarPath, assignOwnership(sidecar, entryName, sourceId));
		await atomicWriteFile(filePath, nextConfig.text, { encoding: "utf8" });
		return {
			kind: "written",
			reason: existing.kind === "absent" ? "created" : "updated",
		};
	}
}

function assignOwnership(sidecar: Sidecar, entryName: string, sourceId: string): Sidecar {
	return {
		version: SIDECAR_SCHEMA_VERSION,
		managed: Array.from(new Set([...sidecar.managed, entryName])),
		owners: { ...sidecar.owners, [entryName]: sourceId },
	};
}

function removeOwnership(sidecar: Sidecar, entryName: string): Sidecar {
	const owners = { ...sidecar.owners };
	delete owners[entryName];
	return {
		version: SIDECAR_SCHEMA_VERSION,
		managed: sidecar.managed.filter((name) => name !== entryName),
		owners,
	};
}
