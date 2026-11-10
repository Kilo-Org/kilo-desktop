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
	FILE_OBJECT_TYPE,
	FILES_COMMANDS,
	FILES_DEFINITIONS,
	FILES_PANE_KIND,
	FILES_PLUGIN_ID,
	FILES_TELEMETRY_EVENTS,
	OPEN_FILE_TOOL_ID,
} from "./index";

describe("kilo.files manifest", () => {
	const discover = () =>
		discoverPlugins(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
				{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
				{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
				{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
				{ manifest, definitions: FILES_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts and those of the kernel, kilo.core, kilo.shell, kilo.work-sessions and kilo.chat", () => {
		expect(discover().issues).toEqual([]);
	});

	const contributions = (point: `${string}/${string}`) =>
		discover().plugins.find((plugin) => plugin.manifest.id === FILES_PLUGIN_ID)!.manifest
			.contributes!.extensions![point]!;

	const keys = (point: `${string}/${string}`) =>
		contributions(point).map((entry) => `${FILES_PLUGIN_ID}/${String(entry.id)}`);

	it("contributes the pane kind, command and telemetry events its contracts name", () => {
		expect(keys("kilo.work-sessions/pane-kind")).toEqual([FILES_PANE_KIND]);
		expect(contributions("kilo.work-sessions/pane-kind")[0]).toMatchObject({
			openCommand: FILES_COMMANDS.open,
		});
		expect(keys("kernel/command")).toEqual(Object.values(FILES_COMMANDS));
		expect(contributions("kernel/telemetry-event").map((entry) => entry.id)).toEqual(
			Object.values(FILES_TELEMETRY_EVENTS),
		);
	});

	it("opens any file, after more specific openers", () => {
		expect(contributions("kilo.work-sessions/opener")).toEqual([
			expect.objectContaining({
				id: "file",
				match: { type: FILE_OBJECT_TYPE },
				pane: FILES_PANE_KIND,
				priority: -100,
			}),
		]);
	});

	it("keeps origin's wire name for its agent tool", () => {
		expect(keys("kilo.core/tool")).toEqual([`${FILES_PLUGIN_ID}/${OPEN_FILE_TOOL_ID}`]);
		expect(toolWireName(`${FILES_PLUGIN_ID}/${OPEN_FILE_TOOL_ID}`)).toBe("desktop_files_open");
	});
});
