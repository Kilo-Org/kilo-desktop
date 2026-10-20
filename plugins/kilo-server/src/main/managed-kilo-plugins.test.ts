import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	kiloPluginConfigContent,
	listManagedKiloPluginFiles,
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

	it("lists the JavaScript plugin files in the managed directory in a stable order", async () => {
		const directory = path.join(tempDirectory, "kilo-plugins");
		await mkdir(directory);
		await writeFile(path.join(directory, "anaconda-notebooks.js"), "");
		await writeFile(path.join(directory, "anaconda-desktop-caller-context.js"), "");
		await writeFile(path.join(directory, "notes.txt"), "");

		await expect(listManagedKiloPluginFiles(directory)).resolves.toEqual([
			path.join(directory, "anaconda-desktop-caller-context.js"),
			path.join(directory, "anaconda-notebooks.js"),
		]);
	});

	it("lists no plugins when the managed directory does not exist yet", async () => {
		await expect(listManagedKiloPluginFiles(path.join(tempDirectory, "missing"))).resolves.toEqual(
			[],
		);
	});

	it("passes plugins to Kilo as file URLs in inline config alongside the pinned indexing base", () => {
		const file = path.join(tempDirectory, "kilo plugins", "anaconda-notebooks.js");

		expect(JSON.parse(kiloPluginConfigContent([file], "https://api.kilo.ai"))).toEqual({
			indexing: { kilo: { baseUrl: "https://api.kilo.ai" } },
			plugin: [pathToFileURL(file).href],
		});
	});

	it("pins the kilo indexing base even when there are no managed plugin files", () => {
		expect(JSON.parse(kiloPluginConfigContent([], "https://api.kilo.ai"))).toEqual({
			indexing: { kilo: { baseUrl: "https://api.kilo.ai" } },
		});
	});

	it("flows the base URL into the indexing pin unchanged", () => {
		expect(JSON.parse(kiloPluginConfigContent([], "http://127.0.0.1:4999"))).toEqual({
			indexing: { kilo: { baseUrl: "http://127.0.0.1:4999" } },
		});
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
