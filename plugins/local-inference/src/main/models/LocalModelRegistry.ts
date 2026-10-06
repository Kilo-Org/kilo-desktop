import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { KvStore } from "@kilo-desktop/feature-sdk";

import type { LocalModel } from "../../contracts/schemas.js";
import {
	compactModelSettings,
	type LocalModelSettings,
} from "../../shared/settings/model-settings.js";
import {
	compactServerSettings,
	type LocalServerSettings,
} from "../../shared/settings/server-settings.js";

export interface PersistedLocalModels extends Record<string, unknown> {
	models: LocalModel[];
	anacondaDesktopModelsImported?: boolean;
	enabled?: boolean;
	settings?: LocalServerSettings;
}

function slug(value: string): string {
	const result = value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return result || "model";
}

function idFor(filePath: string, name: string): string {
	const suffix = createHash("sha256").update(filePath).digest("hex").slice(0, 8);
	return `${slug(name)}-${suffix}`;
}

/**
 * The KV store is shape-agnostic, so a model persisted before `addedAt`
 * existed (or by a build that omitted it) reaches the contract validator
 * without the field and rejects the whole `models.list` response. Treat an
 * absent or invalid `addedAt` as the epoch so legacy entries stay listable and
 * sort as oldest; `refresh()` writes the repaired value back.
 */
function withAddedAt(model: LocalModel): LocalModel {
	const addedAt = model.addedAt as unknown;
	if (typeof addedAt === "number" && Number.isInteger(addedAt) && addedAt >= 0) {
		return model;
	}
	return { ...model, addedAt: 0 };
}

async function isReadableFile(filePath: string): Promise<boolean> {
	try {
		return (await stat(filePath)).isFile();
	} catch {
		return false;
	}
}

type ModelFileStatus = "available" | "missing" | "unavailable";

async function modelFileStatus(
	filePath: string,
	readStat: typeof stat = stat,
): Promise<ModelFileStatus> {
	try {
		return (await readStat(filePath)).isFile() ? "available" : "missing";
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unavailable";
	}
}

async function hasGgufHeader(filePath: string): Promise<boolean> {
	const file = await open(filePath, "r");
	try {
		const header = Buffer.alloc(4);
		const { bytesRead } = await file.read(header, 0, header.length, 0);
		return bytesRead === 4 && header.toString("ascii") === "GGUF";
	} finally {
		await file.close();
	}
}

/**
 * Owns the persisted GGUF registry. Imported paths remain user-owned, while
 * catalog downloads carry explicit managed-file metadata so destructive
 * actions can never be inferred from their location alone. Canonicalization
 * makes duplicate adds idempotent. Refresh removes entries only when their file
 * is definitely absent; transient filesystem failures preserve metadata as
 * unavailable. Server settings are compacted on read so obsolete fields fall
 * back to current safe defaults.
 */
export class LocalModelRegistry {
	readonly #store: KvStore<PersistedLocalModels>;
	readonly #now: () => number;
	readonly #stat: typeof stat;

	constructor(
		store: KvStore<PersistedLocalModels>,
		now: () => number = Date.now,
		readStat: typeof stat = stat,
	) {
		this.#store = store;
		this.#now = now;
		this.#stat = readStat;
	}

	list(): LocalModel[] {
		const models = this.#store.snapshot().models;
		return Array.isArray(models) ? structuredClone(models.map(withAddedAt)) : [];
	}

	isEnabled(): boolean {
		return this.#store.snapshot().enabled !== false;
	}

	setEnabled(enabled: boolean): void {
		this.#store.set({ enabled });
	}

	serverSettings(): LocalServerSettings {
		const settings = this.#store.snapshot().settings;
		return settings ? (compactServerSettings(settings) ?? {}) : {};
	}

	setServerSettings(settings: LocalServerSettings): LocalServerSettings {
		const compact = compactServerSettings(settings);
		this.#store.set({ settings: compact ?? {} });
		return this.serverSettings();
	}

	isAnacondaDesktopModelsImported(): boolean {
		return this.#store.snapshot().anacondaDesktopModelsImported === true;
	}

	setAnacondaDesktopModelsImported(anacondaDesktopModelsImported: boolean): void {
		this.#store.set({ anacondaDesktopModelsImported });
	}

	async adoptLegacyManagedFiles(modelsDir: string): Promise<void> {
		const managedRoot = await realpath(modelsDir);
		const models = this.list();
		let changed = false;
		for (const [index, model] of models.entries()) {
			if (model.managedFile) continue;
			if (!model.catalog) continue;
			try {
				const canonicalPath = await realpath(model.path);
				const relative = path.relative(managedRoot, canonicalPath);
				if (
					relative.length === 0 ||
					relative.startsWith(`..${path.sep}`) ||
					path.isAbsolute(relative) ||
					path.extname(canonicalPath).toLowerCase() !== ".gguf"
				) {
					continue;
				}
				const details = await stat(canonicalPath);
				if (!details.isFile() || details.size <= 0) continue;
				models[index] = {
					...model,
					managedFile: true,
					sizeBytes: model.sizeBytes ?? details.size,
				};
				changed = true;
			} catch {
				// An unresolvable legacy file is not safe to adopt as app-managed.
			}
		}
		if (changed) this.#store.set({ models });
	}

	async add(
		inputPath: string,
		displayName?: string,
		catalog?: LocalModel["catalog"],
		fileMetadata?: Pick<LocalModel, "managedFile" | "sizeBytes">,
	): Promise<LocalModel> {
		if (/[\r\n]/.test(inputPath)) {
			throw new Error("GGUF file paths cannot contain line breaks.");
		}
		if (path.extname(inputPath).toLowerCase() !== ".gguf") {
			throw new Error("Local models must be GGUF files.");
		}
		if (!(await isReadableFile(inputPath))) {
			throw new Error("The selected GGUF file does not exist or is not readable.");
		}
		if (!(await hasGgufHeader(inputPath))) {
			throw new Error("The selected file is not a valid GGUF model.");
		}
		const canonicalPath = await realpath(inputPath);
		const existing = this.list().find((model) => model.path === canonicalPath);
		if (existing) {
			const nextCatalog = catalog ?? existing.catalog;
			const nextManagedFile = fileMetadata?.managedFile ?? existing.managedFile;
			const nextSizeBytes = fileMetadata?.sizeBytes ?? existing.sizeBytes;
			if (
				nextCatalog === existing.catalog &&
				nextManagedFile === existing.managedFile &&
				nextSizeBytes === existing.sizeBytes
			) {
				return existing;
			}
			const models = this.list();
			const index = models.findIndex((model) => model.id === existing.id);
			const next: LocalModel = {
				...existing,
				...(nextCatalog ? { catalog: nextCatalog } : {}),
				...(nextManagedFile === undefined ? {} : { managedFile: nextManagedFile }),
				...(nextSizeBytes === undefined ? {} : { sizeBytes: nextSizeBytes }),
			};
			models[index] = next;
			this.#store.set({ models });
			return structuredClone(next);
		}

		const fallback = path.basename(canonicalPath, path.extname(canonicalPath));
		const name = displayName?.trim() || fallback;
		const model: LocalModel = {
			id: idFor(canonicalPath, name),
			name,
			path: canonicalPath,
			available: true,
			addedAt: this.#now(),
			...(catalog ? { catalog } : {}),
			...(fileMetadata?.managedFile === undefined ? {} : { managedFile: fileMetadata.managedFile }),
			...(fileMetadata?.sizeBytes === undefined ? {} : { sizeBytes: fileMetadata.sizeBytes }),
		};
		this.#store.set({ models: [...this.list(), model] });
		return model;
	}

	remove(id: string): boolean {
		const models = this.list();
		const next = models.filter((model) => model.id !== id);
		if (next.length === models.length) return false;
		this.#store.set({ models: next });
		return true;
	}

	update(id: string, settings: LocalModelSettings): LocalModel | undefined {
		const models = this.list();
		const index = models.findIndex((model) => model.id === id);
		if (index === -1) return undefined;
		const current = models[index];
		if (!current) return undefined;
		const compact = compactModelSettings(settings);
		const next: LocalModel = { ...current };
		if (compact) next.settings = compact;
		else delete next.settings;
		models[index] = next;
		this.#store.set({ models });
		return structuredClone(next);
	}

	async refresh(): Promise<LocalModel[]> {
		const statuses = await Promise.all(
			this.list().map(async (model) => ({
				model,
				status: await modelFileStatus(model.path, this.#stat),
			})),
		);
		const models = statuses
			.filter(({ status }) => status !== "missing")
			.map(({ model, status }) => ({ ...model, available: status === "available" }));
		this.#store.set({ models });
		return models;
	}
}
