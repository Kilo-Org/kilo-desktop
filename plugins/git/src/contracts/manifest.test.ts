import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS, toolWireName } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import {
	CHANGES_OPEN_TOOL_ID,
	CHANGES_PANE_KIND,
	GIT_COMMANDS,
	GIT_DEFINITIONS,
	GIT_PLUGIN_ID,
	GIT_PROTOCOL_SCHEME,
	GIT_TELEMETRY_EVENTS,
} from "./index";

describe("kilo.git manifest", () => {
	const discover = () =>
		discoverPlugins(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
				{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
				{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
				{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
				{ manifest, definitions: GIT_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts and those of the kernel, kilo.core, kilo.shell, kilo.work-sessions and kilo.chat", () => {
		expect(discover().issues).toEqual([]);
	});

	const contributions = (point: `${string}/${string}`) =>
		discover().plugins.find((plugin) => plugin.manifest.id === GIT_PLUGIN_ID)!.manifest.contributes!
			.extensions![point]!;

	const keys = (point: `${string}/${string}`) =>
		contributions(point).map((entry) => `${GIT_PLUGIN_ID}/${String(entry.id)}`);

	it("is the version control for work sessions", () => {
		expect(keys("kilo.work-sessions/vcs")).toEqual([`${GIT_PLUGIN_ID}/git`]);
	});

	it("contributes the pane kind, commands and telemetry events its contracts name", () => {
		expect(keys("kilo.work-sessions/pane-kind")).toEqual([CHANGES_PANE_KIND]);
		expect(contributions("kilo.work-sessions/pane-kind")[0]).toMatchObject({
			openCommand: GIT_COMMANDS.openChanges,
		});
		expect(keys("kernel/command")).toEqual(Object.values(GIT_COMMANDS));
		expect(contributions("kernel/telemetry-event").map((entry) => entry.id)).toEqual(
			Object.values(GIT_TELEMETRY_EVENTS),
		);
	});

	it("keeps origin's wire name for its agent tool", () => {
		expect(keys("kilo.core/tool")).toEqual([`${GIT_PLUGIN_ID}/${CHANGES_OPEN_TOOL_ID}`]);
		expect(toolWireName(`${GIT_PLUGIN_ID}/${CHANGES_OPEN_TOOL_ID}`)).toBe(
			"desktop_git_changes_open",
		);
	});

	it("may serve its patch protocol", () => {
		expect(manifest.permissions.protocols).toEqual([GIT_PROTOCOL_SCHEME]);
	});
});
