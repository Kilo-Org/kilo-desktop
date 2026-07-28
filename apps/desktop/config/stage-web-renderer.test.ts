import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assertWebBuildPresent, stageWebRenderer } from "./stage-web-renderer.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "anaconda-packaging-"));
	temporaryDirectories.push(directory);
	return directory;
}

describe("stageWebRenderer", () => {
	it("fails clearly when the web build is missing", async () => {
		const missing = await temporaryDirectory();
		await expect(assertWebBuildPresent(missing)).rejects.toThrow(/Web build is missing/);
	});

	it("copies web dist into the staged renderer location", async () => {
		const dist = await temporaryDirectory();
		const buildPath = await temporaryDirectory();
		await writeFile(path.join(dist, "index.html"), "<!doctype html><title>web</title>");
		await mkdir(path.join(dist, "assets"), { recursive: true });
		await writeFile(path.join(dist, "assets", "app.js"), "console.log('ok')");

		await stageWebRenderer(buildPath, dist);

		await expect(
			readFile(path.join(buildPath, ".vite/renderer/main_window/index.html"), "utf8"),
		).resolves.toContain("web");
		await expect(
			readFile(path.join(buildPath, ".vite/renderer/main_window/assets/app.js"), "utf8"),
		).resolves.toBe("console.log('ok')");
	});
});
