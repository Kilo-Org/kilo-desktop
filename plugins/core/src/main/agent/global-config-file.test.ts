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

	it("defaults to kilo2.jsonc when no global config file exists", async () => {
		await expect(resolveGlobalConfigFile(directory)).resolves.toEqual({
			path: path.join(directory, "kilo2.jsonc"),
			exists: false,
		});
	});

	it("picks the file Kilo v2 reads last, ignoring v1's config files", async () => {
		await writeFile(path.join(directory, "kilo.jsonc"), "{}");
		await writeFile(path.join(directory, "kilo2.json"), "{}");
		await expect(resolveGlobalConfigFile(directory)).resolves.toEqual({
			path: path.join(directory, "kilo2.json"),
			exists: true,
		});

		await writeFile(path.join(directory, "kilo2.jsonc"), "{}");
		await expect(resolveGlobalConfigFile(directory)).resolves.toEqual({
			path: path.join(directory, "kilo2.jsonc"),
			exists: true,
		});
	});

	it("reports a missing config directory as not existing", async () => {
		const missing = path.join(directory, "missing");
		await expect(resolveGlobalConfigFile(missing)).resolves.toEqual({
			path: path.join(missing, "kilo2.jsonc"),
			exists: false,
		});
	});
});
