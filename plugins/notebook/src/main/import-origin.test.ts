import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createMemoryStorage } from "@kilo-desktop/kernel/testing";

import { importOriginNotebookData } from "./import-origin.js";
import { NotebookSettingsStore, NotebookStateStore } from "./settings/NotebookSettingsStore.js";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function setup() {
	const originDir = await mkdtemp(path.join(os.tmpdir(), "notebook-origin-"));
	directories.push(originDir);
	const storage = createMemoryStorage("/data/kilo.notebook");
	return {
		originDir,
		settings: new NotebookSettingsStore(storage),
		state: new NotebookStateStore(storage),
	};
}

describe("importOriginNotebookData", () => {
	it("counts files that aren't JSON as imported", async () => {
		const { originDir, settings, state } = await setup();
		await writeFile(path.join(originDir, "settings.json"), "{ not json");
		await writeFile(path.join(originDir, "notebook-state.json"), "[");

		await importOriginNotebookData(originDir, settings, state);

		expect(state.importedFromOrigin).toBe(true);
		expect(settings.get()).toEqual({ autoCreateEnvironmentFile: true, trustNewNotebooks: false });
	});

	it("retries files it can't read, and keeps settings changed here meanwhile", async () => {
		const { originDir, settings, state } = await setup();
		await mkdir(path.join(originDir, "settings.json"));
		await expect(importOriginNotebookData(originDir, settings, state)).rejects.toThrow();
		expect(state.importedFromOrigin).toBe(false);
		settings.update({ autoCreateEnvironmentFile: false });

		await rm(path.join(originDir, "settings.json"), { recursive: true });
		await writeFile(
			path.join(originDir, "settings.json"),
			JSON.stringify({ autoCreateEnvironmentFile: true, trustNewNotebooks: true }),
		);
		await importOriginNotebookData(originDir, settings, state);

		expect(settings.get()).toEqual({ autoCreateEnvironmentFile: false, trustNewNotebooks: true });
		expect(state.importedFromOrigin).toBe(true);
	});

	it("keeps a setting chosen here even when it was set back to the default", async () => {
		const { originDir, settings, state } = await setup();
		settings.update({ trustNewNotebooks: true });
		settings.update({ trustNewNotebooks: false });
		await writeFile(
			path.join(originDir, "settings.json"),
			JSON.stringify({ autoCreateEnvironmentFile: false, trustNewNotebooks: true }),
		);

		await importOriginNotebookData(originDir, settings, state);

		expect(settings.get()).toEqual({ autoCreateEnvironmentFile: false, trustNewNotebooks: false });
	});

	it("doesn't count origin's values as chosen here", async () => {
		const { originDir, settings, state } = await setup();
		await writeFile(
			path.join(originDir, "settings.json"),
			JSON.stringify({ trustNewNotebooks: true }),
		);
		await importOriginNotebookData(originDir, settings, state);

		settings.adoptOrigin({ trustNewNotebooks: false });

		expect(settings.get().trustNewNotebooks).toBe(false);
	});
});
