import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import type { KvStore } from "@kilo-desktop/feature-sdk";

import { LocalModelRegistry, type PersistedLocalModels } from "./LocalModelRegistry.js";

const roots: string[] = [];

async function fixture(name: string): Promise<string> {
	const root = path.join(tmpdir(), `local-model-registry-${crypto.randomUUID()}`);
	roots.push(root);
	await mkdir(root, { recursive: true });
	const file = path.join(root, name);
	await writeFile(file, "GGUF");
	return file;
}

function store(initial: PersistedLocalModels = { models: [] }): KvStore<PersistedLocalModels> {
	let value = structuredClone(initial);
	return {
		snapshot: () => structuredClone(value),
		get: (key) => structuredClone(value[key]),
		set: (patch) => {
			value = { ...value, ...structuredClone(patch) };
			return structuredClone(value);
		},
		clear: () => {
			value = { models: [] };
		},
	};
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("LocalModelRegistry", () => {
	it("registers a canonical GGUF path with a stable id and display name", async () => {
		const file = await fixture("Qwen-3-Q4.gguf");
		const registry = new LocalModelRegistry(store(), () => 42);

		const model = await registry.add(file);

		expect(model).toMatchObject({
			name: "Qwen-3-Q4",
			path: await realpath(file),
			available: true,
			addedAt: 42,
		});
		expect(model.id).toMatch(/^qwen-3-q4-[a-f0-9]{8}$/);
		expect(await registry.add(file)).toEqual(model);
		expect(registry.list()).toEqual([model]);
	});

	it("persists catalog identity on downloaded and previously imported models", async () => {
		const file = await fixture("catalog-model.gguf");
		const kv = store();
		const registry = new LocalModelRegistry(kv, () => 42);
		const catalog = { modelId: "catalog-model", quantizationId: "catalog-model-q4" };

		const imported = await registry.add(file);
		expect(imported.catalog).toBeUndefined();
		const matched = await registry.add(file, undefined, catalog, {
			managedFile: true,
			sizeBytes: 4,
		});
		expect(matched.catalog).toEqual(catalog);
		expect(matched).toMatchObject({ managedFile: true, sizeBytes: 4 });

		const restored = new LocalModelRegistry(kv);
		expect(restored.list()[0]?.catalog).toEqual(catalog);
		expect(restored.list()[0]).toMatchObject({ managedFile: true, sizeBytes: 4 });
	});

	it("adopts legacy catalog files only from the managed models directory", async () => {
		const managedFile = await fixture("catalog.gguf");
		const importedFile = await fixture("imported.gguf");
		const managedRoot = path.dirname(managedFile);
		const kv = store();
		const registry = new LocalModelRegistry(kv, () => 42);
		const catalog = { modelId: "catalog-model", quantizationId: "q4" };
		await registry.add(managedFile, undefined, catalog);
		await registry.add(importedFile, undefined, catalog);

		await registry.adoptLegacyManagedFiles(managedRoot);

		expect(registry.list()).toEqual([
			expect.objectContaining({
				path: await realpath(managedFile),
				managedFile: true,
				sizeBytes: 4,
			}),
			expect.not.objectContaining({ managedFile: true }),
		]);
	});

	it("rejects missing files and non-GGUF paths", async () => {
		const text = await fixture("model.txt");
		const mislabeled = await fixture("model.gguf");
		await writeFile(mislabeled, "NOPE");
		const registry = new LocalModelRegistry(store());

		await expect(registry.add(text)).rejects.toThrow("GGUF");
		await expect(registry.add(`${text}.gguf`)).rejects.toThrow("does not exist");
		await expect(registry.add(mislabeled)).rejects.toThrow("valid GGUF");
		await expect(registry.add("model\n.gguf")).rejects.toThrow("line breaks");
	});

	it("removes models whose files are missing", async () => {
		const file = await fixture("model.gguf");
		const registry = new LocalModelRegistry(store());
		await registry.add(file);
		await rm(file);

		await registry.refresh();

		expect(registry.list()).toEqual([]);
	});

	it("preserves model metadata when file access fails transiently", async () => {
		const model = {
			id: "external-model",
			name: "External model",
			path: "/external/model.gguf",
			available: true,
			addedAt: 42,
			settings: { temperature: 0.2 },
		};
		const accessError = Object.assign(new Error("Drive is busy"), { code: "EBUSY" });
		const registry = new LocalModelRegistry(store({ models: [model] }), Date.now, async () => {
			throw accessError;
		});

		await registry.refresh();

		expect(registry.list()).toEqual([{ ...model, available: false }]);
	});

	it("slugs punctuation-only names to a stable model prefix", async () => {
		const file = await fixture("---.gguf");
		const registry = new LocalModelRegistry(store(), () => 1);

		const model = await registry.add(file);

		expect(model.name).toBe("---");
		expect(model.id).toMatch(/^model-[a-f0-9]{8}$/);
	});

	it("treats a corrupt models snapshot as empty", () => {
		const registry = new LocalModelRegistry(
			store({ models: undefined as unknown as PersistedLocalModels["models"] }),
		);

		expect(registry.list()).toEqual([]);
	});

	it("updates model settings and omits empty values", async () => {
		const file = await fixture("model.gguf");
		const registry = new LocalModelRegistry(store());
		const model = await registry.add(file);

		const withSettings = registry.update(model.id, {
			temperature: 0.2,
			contextLength: 8192,
			maxResponseTokens: 2048,
			llamaFlags: { "flash-attn": "on" },
		});
		expect(withSettings).toMatchObject({
			id: model.id,
			settings: {
				temperature: 0.2,
				contextLength: 8192,
				maxResponseTokens: 2048,
				llamaFlags: { "flash-attn": "on" },
			},
		});
		expect(registry.update(model.id, {})).toEqual({
			...model,
		});
		expect(registry.list()[0]).not.toHaveProperty("settings");
		expect(registry.update("missing", { temperature: 0.1 })).toBeUndefined();
	});

	it("defaults to enabled and persists disconnect", async () => {
		const file = await fixture("model.gguf");
		const registry = new LocalModelRegistry(store());
		await registry.add(file);

		expect(registry.isEnabled()).toBe(true);
		registry.setEnabled(false);
		expect(registry.isEnabled()).toBe(false);
		expect(registry.list()).toHaveLength(1);
		registry.setEnabled(true);
		expect(registry.isEnabled()).toBe(true);
	});

	it("persists server settings independently of registered models", () => {
		const registry = new LocalModelRegistry(store());

		expect(registry.serverSettings()).toEqual({});
		expect(
			registry.setServerSettings({
				port: 8080,
				modelLoadMode: "all",
				serveOnLocalNetwork: true,
				llamaFlags: { timeout: "120" },
			}),
		).toEqual({
			port: 8080,
			modelLoadMode: "all",
			serveOnLocalNetwork: true,
			llamaFlags: { timeout: "120" },
		});
		expect(registry.serverSettings()).toEqual({
			port: 8080,
			modelLoadMode: "all",
			serveOnLocalNetwork: true,
			llamaFlags: { timeout: "120" },
		});
		expect(registry.setServerSettings({})).toEqual({});
		expect(registry.serverSettings()).toEqual({});
		expect(registry.list()).toEqual([]);
	});

	it("treats legacy numeric model limits as the safe default", () => {
		const registry = new LocalModelRegistry(
			store({
				models: [],
				settings: { maxModels: 4, port: 8080 } as unknown as NonNullable<
					PersistedLocalModels["settings"]
				>,
			}),
		);

		expect(registry.serverSettings()).toEqual({ port: 8080 });
	});

	it("manages anacondaDesktopModelsImported value", () => {
		const kv = store();
		const registry = new LocalModelRegistry(kv);

		expect(registry.isAnacondaDesktopModelsImported()).toBe(false);
		registry.setAnacondaDesktopModelsImported(true);
		expect(registry.isAnacondaDesktopModelsImported()).toBe(true);

		// value is properly stored
		expect(kv.snapshot().anacondaDesktopModelsImported).toBe(true);

		// value is properly restored
		expect(new LocalModelRegistry(kv).isAnacondaDesktopModelsImported()).toBe(true);
	});
});
