import { createHash } from "node:crypto";
import { open, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { KvStore } from "@anaconda-agentic-desktop/feature-sdk";

import type { LocalModel } from "../contracts/schemas.js";
import { compactModelSettings, type LocalModelSettings } from "../shared/model-settings.js";
import { compactServerSettings, type LocalServerSettings } from "../shared/server-settings.js";

export interface PersistedLocalModels extends Record<string, unknown> {
	models: LocalModel[];
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

async function isReadableFile(filePath: string): Promise<boolean> {
	try {
		return (await stat(filePath)).isFile();
	} catch {
		return false;
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
 * Owns the persisted GGUF registry. Paths remain user-owned and are never
 * copied; canonicalization makes duplicate adds idempotent, while availability
 * is refreshed independently so disconnected drives do not destroy metadata.
 * Server settings are compacted on read so obsolete fields cannot cross the
 * feature contract and instead fall back to current safe defaults.
 */
export class LocalModelRegistry {
	readonly #store: KvStore<PersistedLocalModels>;
	readonly #now: () => number;

	constructor(store: KvStore<PersistedLocalModels>, now: () => number = Date.now) {
		this.#store = store;
		this.#now = now;
	}

	list(): LocalModel[] {
		const models = this.#store.snapshot().models;
		return Array.isArray(models) ? structuredClone(models) : [];
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

	async add(inputPath: string, displayName?: string): Promise<LocalModel> {
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
		if (existing) return existing;

		const fallback = path.basename(canonicalPath, path.extname(canonicalPath));
		const name = displayName?.trim() || fallback;
		const model: LocalModel = {
			id: idFor(canonicalPath, name),
			name,
			path: canonicalPath,
			available: true,
			addedAt: this.#now(),
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
		const models = await Promise.all(
			this.list().map(async (model) => ({
				...model,
				available: await isReadableFile(model.path),
			})),
		);
		this.#store.set({ models });
		return models;
	}
}
