import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { importOriginHistory } from "./import-origin";

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function layout() {
	const root = await mkdtemp(path.join(os.tmpdir(), "terminal-origin-"));
	directories.push(root);
	const originDir = path.join(root, "terminal");
	const storageDir = path.join(root, "kilo.terminal");
	await mkdir(path.join(originDir, "history"), { recursive: true });
	return { originDir, storageDir, history: path.join(storageDir, "history") };
}

describe("importOriginHistory", () => {
	it("copies origin's transcripts, keeping ones written here, and leaves no partial files", async () => {
		const { originDir, storageDir, history } = await layout();
		await writeFile(path.join(originDir, "history", "a.log"), "origin a");
		await writeFile(path.join(originDir, "history", "b.log"), "origin b");
		await mkdir(history, { recursive: true });
		await writeFile(path.join(history, "b.log"), "mine");

		await importOriginHistory(originDir, storageDir);

		expect(await readFile(path.join(history, "a.log"), "utf8")).toBe("origin a");
		expect(await readFile(path.join(history, "b.log"), "utf8")).toBe("mine");
		expect((await readdir(history)).sort()).toEqual(["a.log", "b.log"]);
	});

	it("finishes a copy a crash interrupted", async () => {
		const { originDir, storageDir, history } = await layout();
		await writeFile(path.join(originDir, "history", "a.log"), "the whole transcript");
		await mkdir(history, { recursive: true });
		await writeFile(path.join(history, "a.log.importing"), "the wh");

		await importOriginHistory(originDir, storageDir);

		expect(await readFile(path.join(history, "a.log"), "utf8")).toBe("the whole transcript");
		expect(await readdir(history)).toEqual(["a.log"]);
	});

	it("has nothing to import without origin's folder", async () => {
		const { storageDir } = await layout();

		await expect(importOriginHistory("/no/such/origin", storageDir)).resolves.toBeUndefined();
	});
});
