import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { KiloPluginConfig } from "./KiloPluginConfig.js";

describe("KiloPluginConfig", () => {
	let tempDirectory: string;
	let pluginDirectory: string;
	let sourcePath: string;

	beforeEach(async () => {
		tempDirectory = await mkdtemp(path.join(tmpdir(), "kilo-plugin-config-"));
		pluginDirectory = path.join(tempDirectory, "runtime", "kilo-plugins");
		sourcePath = path.join(tempDirectory, "notebooks-v2");
		await mkdir(sourcePath);
		await writeFile(path.join(sourcePath, "index.js"), "export default { id: 'notebooks' };\n");
	});

	afterEach(async () => {
		await rm(tempDirectory, { recursive: true, force: true });
	});

	it("installs, updates, and removes a Desktop-owned Kilo plugin", async () => {
		const config = new KiloPluginConfig(pluginDirectory);

		await expect(config.install("notebook", "notebooks", sourcePath)).resolves.toEqual({
			kind: "written",
			reason: "created",
		});
		const installedPath = path.join(pluginDirectory, "anaconda-notebooks", "index.js");
		expect(await readFile(installedPath, "utf8")).toBe(
			"// Kilo Desktop managed plugin: notebook/notebooks\n" +
				"export default { id: 'notebooks' };\n",
		);

		await expect(config.install("notebook", "notebooks", sourcePath)).resolves.toEqual({
			kind: "skipped",
			reason: "up-to-date",
		});
		await writeFile(path.join(sourcePath, "index.js"), "export default { id: 'notebooks-v2' };\n");
		await expect(config.install("notebook", "notebooks", sourcePath)).resolves.toEqual({
			kind: "written",
			reason: "updated",
		});
		await expect(config.remove("notebook", "notebooks")).resolves.toEqual({
			kind: "removed",
			reason: "explicit",
		});
		await expect(readFile(installedPath)).rejects.toThrow(/ENOENT/);
	});

	it("lists only plugins owned by the requested source", async () => {
		const otherSourcePath = path.join(tempDirectory, "other");
		await mkdir(otherSourcePath);
		await writeFile(path.join(otherSourcePath, "index.js"), "export default { id: 'other' };\n");
		const config = new KiloPluginConfig(pluginDirectory);
		await config.install("notebook", "notebooks", sourcePath);
		await config.install("other-feature", "other", otherSourcePath);

		await expect(config.listOwnedPluginIds("notebook")).resolves.toEqual(["notebooks"]);
		await expect(config.listOwnedPluginIds("other-feature")).resolves.toEqual(["other"]);
	});

	it("refuses a plugin folder without an entry", async () => {
		const empty = path.join(tempDirectory, "empty");
		await mkdir(empty);

		await expect(
			new KiloPluginConfig(pluginDirectory).install("notebook", "x", empty),
		).resolves.toEqual({
			kind: "skipped-error",
			reason: "the plugin folder has no index.js",
		});
	});

	it("refuses to overwrite or remove a plugin file it does not own", async () => {
		await mkdir(path.join(pluginDirectory, "anaconda-notebooks"), { recursive: true });
		const installedPath = path.join(pluginDirectory, "anaconda-notebooks", "index.js");
		await writeFile(installedPath, "export default { id: 'user-plugin' };\n");
		const config = new KiloPluginConfig(pluginDirectory);

		await expect(config.install("notebook", "notebooks", sourcePath)).resolves.toEqual({
			kind: "skipped-error",
			reason: "plugin file is not owned by notebook",
		});
		await expect(config.remove("notebook", "notebooks")).resolves.toEqual({
			kind: "skipped",
			reason: "not-owned",
		});
		expect(await readFile(installedPath, "utf8")).toContain("user-plugin");
	});
});
