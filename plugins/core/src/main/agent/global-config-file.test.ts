import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveGlobalConfigFile } from "./global-config-file.js";

describe("resolveGlobalConfigFile", () => {
	let directory: string;

	beforeEach(async () => {
		directory = await mkdtemp(path.join(os.tmpdir(), "kilo-global-config-"));
	});

	afterEach(async () => {
		await rm(directory, { recursive: true, force: true });
	});

	it("defaults to kilo.jsonc when no global config file exists", async () => {
		await expect(resolveGlobalConfigFile(directory)).resolves.toEqual({
			path: path.join(directory, "kilo.jsonc"),
			exists: false,
		});
	});

	it("picks the first existing file in Kilo's lookup order", async () => {
		await writeFile(path.join(directory, "config.json"), "{}");
		await writeFile(path.join(directory, "opencode.json"), "{}");
		await expect(resolveGlobalConfigFile(directory)).resolves.toEqual({
			path: path.join(directory, "opencode.json"),
			exists: true,
		});

		await writeFile(path.join(directory, "kilo.json"), "{}");
		await expect(resolveGlobalConfigFile(directory)).resolves.toEqual({
			path: path.join(directory, "kilo.json"),
			exists: true,
		});
	});

	it("reports a missing config directory as not existing", async () => {
		const missing = path.join(directory, "missing");
		await expect(resolveGlobalConfigFile(missing)).resolves.toEqual({
			path: path.join(missing, "kilo.jsonc"),
			exists: false,
		});
	});
});
