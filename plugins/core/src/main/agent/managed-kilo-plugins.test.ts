import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	listManagedKiloPlugins,
	removeLegacyKiloConfigPlugins,
	removeLegacyKiloPluginFiles,
	writeManagedKiloPlugin,
} from "./managed-kilo-plugins.js";

describe("managed Kilo plugins", () => {
	let tempDirectory: string;

	beforeEach(async () => {
		tempDirectory = await mkdtemp(path.join(tmpdir(), "managed-kilo-plugins-"));
	});

	afterEach(async () => {
		await rm(tempDirectory, { recursive: true, force: true });
	});

	it("lists the plugin directories that hold an entry, in a stable order", async () => {
		const directory = path.join(tempDirectory, "kilo-plugins");
		await writeManagedKiloPlugin(directory, "anaconda-notebooks", "export default {};\n");
		await writeManagedKiloPlugin(
			directory,
			"anaconda-desktop-caller-context",
			"export default {};\n",
		);
		await mkdir(path.join(directory, "empty"));
		await writeFile(path.join(directory, "anaconda-legacy.js"), "");

		await expect(listManagedKiloPlugins(directory)).resolves.toEqual([
			path.join(directory, "anaconda-desktop-caller-context"),
			path.join(directory, "anaconda-notebooks"),
		]);
	});

	it("writes a plugin as an ES module directory Kilo v2 loads, only when it changed", async () => {
		const directory = path.join(tempDirectory, "kilo-plugins");

		await expect(
			writeManagedKiloPlugin(directory, "anaconda-x", "export default 1;\n"),
		).resolves.toBe(true);
		await expect(
			writeManagedKiloPlugin(directory, "anaconda-x", "export default 1;\n"),
		).resolves.toBe(false);
		await expect(
			writeManagedKiloPlugin(directory, "anaconda-x", "export default 2;\n"),
		).resolves.toBe(true);

		expect(
			JSON.parse(await readFile(path.join(directory, "anaconda-x", "package.json"), "utf8")),
		).toEqual({
			private: true,
			type: "module",
		});
		await expect(readFile(path.join(directory, "anaconda-x", "index.js"), "utf8")).resolves.toBe(
			"export default 2;\n",
		);
	});

	it("lists no plugins when the managed directory does not exist yet", async () => {
		await expect(listManagedKiloPlugins(path.join(tempDirectory, "missing"))).resolves.toEqual([]);
	});

	it("removes the single-file plugins Kilo v1 builds left in the managed directory", async () => {
		const directory = path.join(tempDirectory, "kilo-plugins");
		await writeManagedKiloPlugin(directory, "anaconda-notebooks", "export default {};\n");
		await writeFile(
			path.join(directory, "anaconda-notebooks.js"),
			"// Kilo Desktop managed plugin: kilo.notebook/notebooks\nexport default {};\n",
		);
		await writeFile(path.join(directory, "anaconda-desktop-caller-context.js"), "");
		await writeFile(path.join(directory, "user.js"), "export default {};\n");

		await removeLegacyKiloPluginFiles(directory);

		expect((await readdir(directory)).sort()).toEqual(["anaconda-notebooks", "user.js"]);
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
