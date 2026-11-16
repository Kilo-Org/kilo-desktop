import { link, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import { importOriginLocalInference, type OriginLocalInferenceStore } from "./import-origin";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function layout() {
	const root = await mkdtemp(path.join(os.tmpdir(), "import-origin-"));
	directories.push(root);
	const originDir = path.join(root, "local-inference");
	const storageDir = path.join(root, "kilo.local-inference");
	await mkdir(originDir, { recursive: true });
	await mkdir(storageDir, { recursive: true });
	const store = createMemoryStorage(storageDir).kv<OriginLocalInferenceStore>({
		namespace: "models",
		defaults: { models: [] },
	});
	return { originDir, storageDir, store };
}

const model = (id: string, modelPath: string) => ({
	id,
	name: id,
	path: modelPath,
	available: true,
	addedAt: 1,
});

describe("importOriginLocalInference", () => {
	it("counts a missing registry as imported", async () => {
		const { originDir, storageDir, store } = await layout();

		await importOriginLocalInference({ originDir, storageDir, store });

		expect(store.snapshot()).toEqual({ models: [], importedFromOrigin: true });
	});

	it("imports only once", async () => {
		const { originDir, storageDir, store } = await layout();
		await writeFile(
			path.join(originDir, "models.json"),
			JSON.stringify({ models: [model("theirs", "/models/theirs.gguf")] }),
		);

		await importOriginLocalInference({ originDir, storageDir, store });
		store.set({ models: [] });
		await importOriginLocalInference({ originDir, storageDir, store });

		expect(store.snapshot().models).toEqual([]);
		expect(store.snapshot().importedFromOrigin).toBe(true);
	});

	it("hard-links origin's downloaded models here and leaves origin's files for a downgrade", async () => {
		const { originDir, storageDir, store } = await layout();
		const originFile = path.join(originDir, "models", "a.gguf");
		await mkdir(path.dirname(originFile));
		await writeFile(originFile, "GGUF");
		const external = model("ext", "/elsewhere/ext.gguf");
		await writeFile(
			path.join(originDir, "models.json"),
			JSON.stringify({ models: [model("a", originFile), external] }),
		);

		await importOriginLocalInference({ originDir, storageDir, store });

		const ownFile = path.join(storageDir, "models", "a.gguf");
		expect(store.snapshot().models).toEqual([model("a", ownFile), external]);
		expect((await stat(ownFile)).ino).toBe((await stat(originFile)).ino);
		expect(await readFile(originFile, "utf8")).toBe("GGUF");
	});

	it("finishes an import interrupted after linking", async () => {
		const { originDir, storageDir, store } = await layout();
		const originFile = path.join(originDir, "models", "a.gguf");
		await mkdir(path.dirname(originFile));
		await writeFile(originFile, "GGUF");
		await mkdir(path.join(storageDir, "models"));
		await link(originFile, path.join(storageDir, "models", "a.gguf"));
		await writeFile(
			path.join(originDir, "models.json"),
			JSON.stringify({ models: [model("a", originFile)] }),
		);

		await importOriginLocalInference({ originDir, storageDir, store });

		expect(store.snapshot().models).toEqual([
			model("a", path.join(storageDir, "models", "a.gguf")),
		]);
	});

	it("keeps pointing at origin's file rather than overwrite a different one here", async () => {
		const { originDir, storageDir, store } = await layout();
		const originFile = path.join(originDir, "models", "a.gguf");
		await mkdir(path.dirname(originFile));
		await writeFile(originFile, "GGUF");
		await mkdir(path.join(storageDir, "models"));
		await writeFile(path.join(storageDir, "models", "a.gguf"), "MINE");
		await writeFile(
			path.join(originDir, "models.json"),
			JSON.stringify({ models: [model("a", originFile)] }),
		);

		await importOriginLocalInference({ originDir, storageDir, store });

		expect(store.snapshot().models).toEqual([model("a", originFile)]);
		expect(await readFile(path.join(storageDir, "models", "a.gguf"), "utf8")).toBe("MINE");
	});

	it("retries a registry it cannot read", async () => {
		const { originDir, storageDir, store } = await layout();
		await mkdir(path.join(originDir, "models.json"));

		await expect(importOriginLocalInference({ originDir, storageDir, store })).rejects.toThrow();

		expect(store.snapshot().importedFromOrigin).toBeUndefined();
	});

	it("counts a registry that isn't JSON as imported", async () => {
		const { originDir, storageDir, store } = await layout();
		await writeFile(path.join(originDir, "models.json"), "{");

		await importOriginLocalInference({ originDir, storageDir, store });

		expect(store.snapshot()).toEqual({ models: [], importedFromOrigin: true });
	});

	it("skips entries it can't read and imports the rest", async () => {
		const { originDir, storageDir, store } = await layout();
		const good = model("good", "/elsewhere/good.gguf");
		await writeFile(
			path.join(originDir, "models.json"),
			JSON.stringify({ models: [{ ...model("bad", "x"), path: 42 }, null, good] }),
		);

		await importOriginLocalInference({ originDir, storageDir, store });

		expect(store.snapshot().models).toEqual([good]);
	});

	it("leaves a model whose file couldn't be linked to origin, not to the app's delete", async () => {
		const { originDir, storageDir, store } = await layout();
		const originFile = path.join(originDir, "models", "a.gguf");
		await mkdir(path.dirname(originFile));
		await writeFile(originFile, "GGUF");
		await writeFile(path.join(storageDir, "models"), "a file where the folder would go");
		await writeFile(
			path.join(originDir, "models.json"),
			JSON.stringify({ models: [{ ...model("a", originFile), managedFile: true }] }),
		);

		await importOriginLocalInference({ originDir, storageDir, store });

		expect(store.snapshot().models).toEqual([{ ...model("a", originFile), managedFile: false }]);
	});

	it("adds origin's models to ones registered meanwhile, keeping settings made here", async () => {
		const { originDir, storageDir, store } = await layout();
		const mine = model("mine", "/models/mine.gguf");
		store.set({ models: [mine], settings: { port: 9000 }, enabled: false });
		await writeFile(
			path.join(originDir, "models.json"),
			JSON.stringify({
				models: [model("dup", "/models/mine.gguf"), model("theirs", "/models/theirs.gguf")],
				settings: { port: 8080 },
				enabled: true,
			}),
		);

		await importOriginLocalInference({ originDir, storageDir, store });

		expect(store.snapshot()).toEqual({
			models: [mine, model("theirs", "/models/theirs.gguf")],
			settings: { port: 9000 },
			enabled: false,
			importedFromOrigin: true,
		});
	});
});
