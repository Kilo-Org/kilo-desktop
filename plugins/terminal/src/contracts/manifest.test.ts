import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS, toolWireName } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import {
	TERMINAL_COMMANDS,
	TERMINAL_DEFINITIONS,
	TERMINAL_FOCUSED_KEY,
	TERMINAL_HOST,
	TERMINAL_PANE_KIND,
	TERMINAL_PLUGIN_ID,
	TERMINAL_TOOL_IDS,
} from "./index";

describe("kilo.terminal manifest", () => {
	const discover = () =>
		discoverPlugins(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
				{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
				{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
				{ manifest, definitions: TERMINAL_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts and those of the kernel, kilo.core, kilo.shell and kilo.work-sessions", () => {
		expect(discover().issues).toEqual([]);
	});

	const contributions = (point: `${string}/${string}`) =>
		discover().plugins.find((plugin) => plugin.manifest.id === TERMINAL_PLUGIN_ID)!.manifest
			.contributes!.extensions![point]!;

	const keys = (point: `${string}/${string}`) =>
		contributions(point).map((entry) => `${TERMINAL_PLUGIN_ID}/${String(entry.id)}`);

	it("contributes the pane kind, commands and context key its contracts name", () => {
		expect(keys("kilo.work-sessions/pane-kind")).toEqual([TERMINAL_PANE_KIND]);
		expect(contributions("kilo.work-sessions/pane-kind")[0]).toMatchObject({
			openCommand: TERMINAL_COMMANDS.open,
			keepAlive: true,
		});
		expect(keys("kernel/command")).toEqual(Object.values(TERMINAL_COMMANDS));
		expect(TERMINAL_FOCUSED_KEY).toBe(`${TERMINAL_PLUGIN_ID}/${manifest.contextKeys[0]!.id}`);
	});

	it("keeps origin's wire names for its agent tools", () => {
		expect(contributions("kilo.core/tool").map((entry) => entry.id)).toEqual([
			...TERMINAL_TOOL_IDS,
		]);
		expect(TERMINAL_TOOL_IDS.map((id) => toolWireName(`${TERMINAL_PLUGIN_ID}/${id}`))).toEqual([
			"desktop_terminal_open",
			"desktop_terminal_list",
			"desktop_terminal_read",
		]);
	});

	it("may embed its terminal frame", () => {
		expect(manifest.permissions.embeddedHosts).toEqual([TERMINAL_HOST]);
	});
});
