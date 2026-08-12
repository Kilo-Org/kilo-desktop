import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { writeFile as atomicWriteFile } from "atomically";
import {
	applyEdits,
	modify,
	parseTree,
	printParseErrorCode,
	type Node,
	type ParseError,
} from "jsonc-parser";

import type { KiloLogger } from "./KiloServerManager.js";

/**
 * Shared managed-MCP seeder for app-owned `kilo.jsonc`.
 *
 * Wire shape follows Kilo's own JSON schema (`McpLocalConfig`) exactly:
 *   `{ type: "local", command: string[], environment?, cwd?, enabled?, timeout? }`
 * with `additionalProperties: false`. The top-level `Config` schema is ALSO
 * `additionalProperties: false`, so we cannot stash our ownership marker
 * anywhere inside `kilo.jsonc` without breaking Kilo's config validation
 * (`kilo serve` exits code 1 on unknown top-level keys). The marker
 * therefore lives in a sidecar file:
 *   `${configDir}/.anaconda-desktop-managed.json`
 * Kilo never opens this file; only we do, and only for ownership tracking.
 *
 * Invariants:
 * - Idempotent: safe to run on every boot; a no-op when kilo.jsonc already
 *   contains our exact managed entry and the sidecar marks it as ours.
 * - Marker-guarded: only entries listed in the sidecar's `managed` array
 *   may be overwritten or removed. User-forked entries (marker absent) are
 *   left alone.
 * - Non-destructive: preserves every sibling top-level key, every sibling
 *   mcp entry, and every JSONC comment/formatting via `jsonc-parser`'s
 *   `modify()` API.
 * - Atomic on-disk update.
 * - Refuse-to-write on unparseable existing files (never clobber user data).
 */

export const KILO_CONFIG_FILENAME = "kilo.jsonc";
export const MANAGED_SIDECAR_FILENAME = ".anaconda-desktop-managed.json";
const SIDECAR_SCHEMA_VERSION = 1;

export interface SeededMcpEntry {
	readonly type: "local";
	readonly command: readonly [string, ...string[]];
	readonly environment?: Readonly<Record<string, string>>;
	readonly enabled: true;
}

export type SeedOutcome =
	| {
			readonly kind: "written";
			readonly reason: "created" | "updated";
			readonly entry: SeededMcpEntry;
	  }
	| {
			readonly kind: "removed";
			readonly reason: "fuse-off" | "explicit";
	  }
	| {
			readonly kind: "skipped";
			readonly reason: "unmanaged-entry" | "up-to-date" | "nothing-to-remove";
	  }
	| { readonly kind: "skipped-error"; readonly reason: string };

export interface SeedManagedMcpEntryOptions {
	readonly configDirectory: string;
	readonly name: string;
	/** Desired entry when `enabled` is true. Ignored when removing. */
	readonly entry?: SeededMcpEntry;
	/**
	 * When `false`, remove a previously-managed entry (leave user-owned
	 * entries alone). Defaults to `true`.
	 */
	readonly enabled?: boolean;
	readonly logger?: Pick<KiloLogger, "info" | "warn" | "error">;
	/** Used in log messages; defaults to `name`. */
	readonly label?: string;
}

interface Sidecar {
	readonly version: number;
	readonly managed: readonly string[];
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
			return {
				version: SIDECAR_SCHEMA_VERSION,
				managed: ((parsed as Record<string, unknown>).managed as unknown[]).filter(
					(entry): entry is string => typeof entry === "string",
				),
			};
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			// A corrupt sidecar is not a reason to break Kilo — treat it as
			// "we manage nothing", so subsequent runs will not touch user
			// entries and the user can delete the sidecar to reset us.
		}
	}
	return { version: SIDECAR_SCHEMA_VERSION, managed: [] };
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
	const body = `${JSON.stringify(sidecar, undefined, 2)}\n`;
	await atomicWriteFile(sidecarPath, body, { encoding: "utf8" });
}

interface ExistingConfig {
	readonly text: string;
	readonly root: Node | undefined;
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

function readMcpEntry(root: Node | undefined, name: string): unknown {
	if (!root || root.type !== "object" || !root.children) return undefined;
	const mcpProperty = root.children.find(
		(child) =>
			child.type === "property" &&
			child.children?.[0]?.type === "string" &&
			child.children[0].value === "mcp",
	);
	const mcpNode = mcpProperty?.children?.[1];
	if (!mcpNode || mcpNode.type !== "object" || !mcpNode.children) return undefined;
	const entryProperty = mcpNode.children.find(
		(child) =>
			child.type === "property" &&
			child.children?.[0]?.type === "string" &&
			child.children[0].value === name,
	);
	const entryNode = entryProperty?.children?.[1];
	return entryNode ? nodeToValue(entryNode) : undefined;
}

function nodeToValue(node: Node | undefined): unknown {
	if (!node) return undefined;
	if (node.type === "object") {
		const result: Record<string, unknown> = {};
		for (const child of node.children ?? []) {
			if (child.type !== "property") continue;
			const [nameNode, valueNode] = child.children ?? [];
			if (!nameNode || nameNode.type !== "string" || !valueNode) continue;
			result[nameNode.value as string] = nodeToValue(valueNode);
		}
		return result;
	}
	if (node.type === "array") {
		return (node.children ?? []).map((child) => nodeToValue(child));
	}
	return node.value;
}

function environmentOf(entry: SeededMcpEntry | Record<string, unknown>): Record<string, unknown> {
	const environment = entry.environment;
	if (!environment || typeof environment !== "object" || Array.isArray(environment)) return {};
	return environment as Record<string, unknown>;
}

function entryEquals(current: unknown, next: SeededMcpEntry): boolean {
	if (!current || typeof current !== "object" || Array.isArray(current)) return false;
	const candidate = current as Record<string, unknown>;
	if (candidate.type !== next.type) return false;
	if (candidate.enabled !== next.enabled) return false;
	if (!Array.isArray(candidate.command)) return false;
	if (candidate.command.length !== next.command.length) return false;
	for (let index = 0; index < candidate.command.length; index += 1) {
		if (candidate.command[index] !== next.command[index]) return false;
	}
	const currentEnvironment = environmentOf(candidate);
	const nextEnvironment = environmentOf(next);
	const expectedEntries = Object.entries(nextEnvironment);
	if (Object.keys(currentEnvironment).length !== expectedEntries.length) return false;
	for (const [key, value] of expectedEntries) {
		if (currentEnvironment[key] !== value) return false;
	}
	return true;
}

function applyModifications(
	text: string,
	modifications: readonly { path: (string | number)[]; value: unknown }[],
): string {
	let result = text || "{}\n";
	for (const modification of modifications) {
		const edits = modify(result, modification.path, modification.value, {
			formattingOptions: { insertSpaces: true, tabSize: 2 },
		});
		result = applyEdits(result, edits);
	}
	if (!result.endsWith("\n")) result += "\n";
	return result;
}

function tryApplyModifications(
	text: string,
	modifications: readonly { path: (string | number)[]; value: unknown }[],
): { ok: true; text: string } | { ok: false; reason: string } {
	try {
		return { ok: true, text: applyModifications(text, modifications) };
	} catch (error) {
		return {
			ok: false,
			reason: `jsonc modify() failed: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

function serializeEntry(entry: SeededMcpEntry): Record<string, unknown> {
	return {
		type: entry.type,
		command: [...entry.command],
		...(entry.environment ? { environment: { ...entry.environment } } : {}),
		enabled: entry.enabled,
	};
}

/**
 * Merge (or remove) a managed MCP entry into `kilo.jsonc`, tracking ownership
 * in a sidecar file that Kilo does not open.
 */
export async function seedManagedMcpEntry(
	options: SeedManagedMcpEntryOptions,
): Promise<SeedOutcome> {
	const logger = options.logger ?? { info() {}, warn() {}, error() {} };
	const enabled = options.enabled ?? true;
	const label = options.label ?? options.name;
	const entryName = options.name;

	const filePath = path.join(options.configDirectory, KILO_CONFIG_FILENAME);
	const sidecarPath = path.join(options.configDirectory, MANAGED_SIDECAR_FILENAME);
	await mkdir(options.configDirectory, { recursive: true });

	const existing = await readExistingConfig(filePath);
	if (existing.kind === "unparseable") {
		logger.warn(
			`Refusing to touch ${filePath}: ${existing.reason}. Fix the file or delete it to re-seed.`,
		);
		return { kind: "skipped-error", reason: existing.reason };
	}

	const sidecar = await readSidecar(sidecarPath);
	const root = existing.kind === "ok" ? existing.config.root : undefined;
	const text = existing.kind === "ok" ? existing.config.text : "";

	const currentEntry = readMcpEntry(root, entryName);
	const managed = sidecar.managed.includes(entryName);

	if (!enabled) {
		if (currentEntry === undefined) {
			if (managed) {
				await writeSidecar(sidecarPath, {
					version: SIDECAR_SCHEMA_VERSION,
					managed: sidecar.managed.filter((name) => name !== entryName),
				});
			}
			return { kind: "skipped", reason: "nothing-to-remove" };
		}
		if (!managed) {
			logger.info(`Leaving mcp["${entryName}"] alone: entry is not tracked by anaconda-desktop.`);
			return { kind: "skipped", reason: "unmanaged-entry" };
		}
		const removed = tryApplyModifications(text, [{ path: ["mcp", entryName], value: undefined }]);
		if (!removed.ok) {
			logger.warn(`Refusing to touch ${filePath}: ${removed.reason}.`);
			return { kind: "skipped-error", reason: removed.reason };
		}
		await atomicWriteFile(filePath, removed.text, { encoding: "utf8" });
		await writeSidecar(sidecarPath, {
			version: SIDECAR_SCHEMA_VERSION,
			managed: sidecar.managed.filter((name) => name !== entryName),
		});
		logger.info(`Removed managed mcp["${entryName}"] entry (${label}).`);
		return { kind: "removed", reason: "explicit" };
	}

	const nextEntry = options.entry;
	if (!nextEntry) {
		return { kind: "skipped-error", reason: `seedManagedMcpEntry("${entryName}") requires entry` };
	}

	if (currentEntry !== undefined && !managed) {
		logger.info(
			`Skipping ${label} seed: mcp["${entryName}"] exists but is not tracked by anaconda-desktop.`,
		);
		return { kind: "skipped", reason: "unmanaged-entry" };
	}

	if (entryEquals(currentEntry, nextEntry) && managed) {
		return { kind: "skipped", reason: "up-to-date" };
	}

	const nextConfig = tryApplyModifications(text, [
		{ path: ["mcp", entryName], value: serializeEntry(nextEntry) },
	]);
	if (!nextConfig.ok) {
		logger.warn(`Refusing to touch ${filePath}: ${nextConfig.reason}.`);
		return { kind: "skipped-error", reason: nextConfig.reason };
	}

	const nextManaged = Array.from(new Set([...sidecar.managed, entryName]));
	await writeSidecar(sidecarPath, { version: SIDECAR_SCHEMA_VERSION, managed: nextManaged });
	await atomicWriteFile(filePath, nextConfig.text, { encoding: "utf8" });

	const reason: "created" | "updated" = existing.kind === "absent" ? "created" : "updated";
	logger.info(`Seeded mcp["${entryName}"] (${reason}) for ${label}.`);
	return { kind: "written", reason, entry: nextEntry };
}
