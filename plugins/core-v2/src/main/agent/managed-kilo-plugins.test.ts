import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	listManagedKiloPluginDirectories,
	removeLegacyKiloConfigPlugins,
} from "./managed-kilo-plugins.js";

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

	it("removes Desktop's plugins from the legacy config plugin directory and keeps user plugins", async () => {
		const configDirectory = path.join(tempDirectory, "config", "kilo");
		const legacyDirectory = path.join(configDirectory, "plugin");
		await mkdir(legacyDirectory, { recursive: true });
		await writeFile(
			path.join(legacyDirectory, "anaconda-notebooks.ts"),
			"// Kilo Desktop managed plugin: notebook/notebooks\nexport default {};\n",
		);
		await writeFile(path.join(legacyDirectory, "anaconda-desktop-caller-context.js"), "");
		await writeFile(path.join(legacyDirectory, "anaconda-mine.ts"), "export default {};\n");
		await writeFile(path.join(legacyDirectory, "user.ts"), "export default {};\n");

		await removeLegacyKiloConfigPlugins(configDirectory);

		expect((await readdir(legacyDirectory)).sort()).toEqual(["anaconda-mine.ts", "user.ts"]);
	});

	it("keeps removing legacy plugins past an entry it cannot process, then reports it", async () => {
		const configDirectory = path.join(tempDirectory, "config", "kilo");
		const legacyDirectory = path.join(configDirectory, "plugin");
		await mkdir(path.join(legacyDirectory, "anaconda-000-stray.ts"), { recursive: true });
		await writeFile(
			path.join(legacyDirectory, "anaconda-notebooks.ts"),
			"// Kilo Desktop managed plugin: notebook/notebooks\nexport default {};\n",
		);
		await writeFile(path.join(legacyDirectory, "anaconda-desktop-caller-context.js"), "");

		await expect(removeLegacyKiloConfigPlugins(configDirectory)).rejects.toThrow(
			/anaconda-000-stray\.ts/,
		);

		expect(await readdir(legacyDirectory)).toEqual(["anaconda-000-stray.ts"]);
	});

	it("tolerates a config directory without a legacy plugin directory", async () => {
		await expect(
			removeLegacyKiloConfigPlugins(path.join(tempDirectory, "missing")),
		).resolves.toBeUndefined();
	});
});
