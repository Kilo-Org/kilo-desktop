import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { listManagedKiloPluginDirectories } from "./managed-kilo-plugins.js";

describe("managed Kilo plugins", () => {
	let tempDirectory: string;

	beforeEach(async () => {
		tempDirectory = await mkdtemp(path.join(tmpdir(), "managed-kilo-plugins-"));
	});

	afterEach(async () => {
		await rm(tempDirectory, { recursive: true, force: true });
	});

	it("lists the plugin folders with an entry in the managed directory in a stable order", async () => {
		const directory = path.join(tempDirectory, "kilo-plugins");
		for (const name of ["anaconda-notebooks", "anaconda-desktop-caller-context", "empty"]) {
			await mkdir(path.join(directory, name), { recursive: true });
		}
		await writeFile(path.join(directory, "anaconda-notebooks", "index.js"), "");
		await writeFile(path.join(directory, "anaconda-desktop-caller-context", "index.js"), "");
		await writeFile(path.join(directory, "anaconda-old.js"), "");

		await expect(listManagedKiloPluginDirectories(directory)).resolves.toEqual([
			path.join(directory, "anaconda-desktop-caller-context"),
			path.join(directory, "anaconda-notebooks"),
		]);
	});

	it("lists no plugins when the managed directory does not exist yet", async () => {
		await expect(
			listManagedKiloPluginDirectories(path.join(tempDirectory, "missing")),
		).resolves.toEqual([]);
	});
});
