import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "jsonc-parser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KILO_V2_CONFIG_FILENAME, KiloConfigManager } from "./KiloConfigManager.js";
import { KiloConfiguration } from "./KiloConfiguration.js";
import { KiloPluginConfig } from "./KiloPluginConfig.js";
import { KiloSkillConfig } from "./KiloSkillConfig.js";

import type { KiloConfigurationState } from "./types.js";

const NOTHING: KiloConfigurationState = {
	mcpEntries: {},
	agents: {},
	commands: {},
	plugins: {},
	skills: {},
};

describe("KiloConfiguration", () => {
	let root: string;
	let configDirectory: string;
	let pluginDirectory: string;
	let skillDirectory: string;
	let pluginFile: string;
	let skillFolder: string;
	let onChanged: ReturnType<typeof vi.fn<() => void>>;
	let warn: ReturnType<typeof vi.fn<(message: string) => void>>;
	let configuration: KiloConfiguration;

	const readConfig = async () =>
		parse(await readFile(path.join(configDirectory, KILO_V2_CONFIG_FILENAME), "utf8")) as Record<
			string,
			Record<string, unknown> | undefined
		>;
	const exists = (file: string) =>
		lstat(file).then(
			() => true,
			() => false,
		);

	const everything: KiloConfigurationState = {
		mcpEntries: { tools: { type: "local", command: ["tools"] } },
		agents: { reviewer: { description: "Reviews", prompt: "Review.", mode: "subagent" } },
		commands: { review: { template: "Review $ARGUMENTS" } },
		plugins: {},
		skills: {},
	};

	beforeEach(async () => {
		root = await mkdtemp(path.join(tmpdir(), "kilo-configuration-"));
		configDirectory = path.join(root, "config", "kilo");
		pluginDirectory = path.join(root, "kilo-plugins");
		skillDirectory = path.join(configDirectory, "skills");
		pluginFile = path.join(root, "acme", "plugin.js");
		skillFolder = path.join(root, "acme", "skills", "review");
		await mkdir(skillFolder, { recursive: true });
		await writeFile(pluginFile, "export default {};\n");
		await writeFile(path.join(skillFolder, "SKILL.md"), "---\nname: review\n---\n");
		Object.assign(everything, {
			plugins: { notebooks: pluginFile },
			skills: { review: skillFolder },
		});
		onChanged = vi.fn<() => void>();
		warn = vi.fn<(message: string) => void>();
		configuration = new KiloConfiguration({
			kiloConfig: new KiloConfigManager(configDirectory),
			pluginConfig: new KiloPluginConfig(pluginDirectory),
			skillConfig: new KiloSkillConfig(skillDirectory),
			onChanged,
			logger: { warn },
		});
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it("writes a source's whole desired state and asks for one restart", async () => {
		await configuration.set("acme.tools", everything);

		expect(await readConfig()).toEqual({
			mcp: { servers: everything.mcpEntries },
			agents: { reviewer: { description: "Reviews", system: "Review.", mode: "subagent" } },
			commands: everything.commands,
		});
		await expect(
			readFile(path.join(pluginDirectory, "anaconda-notebooks.js"), "utf8"),
		).resolves.toContain("export default {};");
		await expect(
			readFile(path.join(skillDirectory, "review", "SKILL.md"), "utf8"),
		).resolves.toContain("name: review");
		expect(onChanged).toHaveBeenCalledOnce();

		await configuration.set("acme.tools", everything);
		expect(onChanged).toHaveBeenCalledOnce();
	});

	it("prunes what a source no longer wants, leaving other sources' entries alone", async () => {
		await configuration.set("acme.tools", everything);
		await configuration.set("acme.other", {
			...NOTHING,
			agents: { other: { description: "Other", prompt: "Other.", mode: "all" } },
		});
		onChanged.mockClear();

		await configuration.set("acme.tools", NOTHING);

		expect(await readConfig()).toEqual({
			mcp: { servers: {} },
			agents: { other: { description: "Other", system: "Other.", mode: "all" } },
			commands: {},
		});
		expect(await exists(path.join(pluginDirectory, "anaconda-notebooks.js"))).toBe(false);
		expect(await exists(path.join(skillDirectory, "review"))).toBe(false);
		expect(await exists(skillFolder)).toBe(true);
		expect(onChanged).toHaveBeenCalledOnce();
	});

	it("leaves an entry the user owns under the same name alone, warning once", async () => {
		await mkdir(configDirectory, { recursive: true });
		await writeFile(
			path.join(configDirectory, KILO_V2_CONFIG_FILENAME),
			JSON.stringify({ commands: { review: { template: "Mine" } } }),
		);
		await mkdir(path.join(skillDirectory, "review"), { recursive: true });

		await configuration.set("acme.tools", everything);
		await configuration.set("acme.tools", everything);

		const config = await readConfig();
		expect(config.commands).toEqual({ review: { template: "Mine" } });
		expect(config.agents).toEqual({
			reviewer: { description: "Reviews", system: "Review.", mode: "subagent" },
		});
		expect(await exists(path.join(skillDirectory, "review", "SKILL.md"))).toBe(false);
		expect(warn.mock.calls).toEqual([
			[expect.stringContaining('skill "review"')],
			[expect.stringContaining('command "review"')],
		]);
	});

	it("applies the rest of a source's state when one part fails, then reports it", async () => {
		await expect(
			configuration.set("acme.tools", {
				...everything,
				plugins: { notebooks: "relative/plugin.js" },
			}),
		).rejects.toThrow('Could not install Desktop-owned Kilo plugin "notebooks"');

		expect((await readConfig()).agents).toEqual({
			reviewer: { description: "Reviews", system: "Review.", mode: "subagent" },
		});
		expect(onChanged).toHaveBeenCalledOnce();
	});
});
