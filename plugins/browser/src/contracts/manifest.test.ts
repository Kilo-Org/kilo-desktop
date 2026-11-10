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
	BROWSER_COMMANDS,
	BROWSER_DEFINITIONS,
	BROWSER_PANE_KIND,
	BROWSER_PLUGIN_ID,
	BROWSER_TELEMETRY_EVENTS,
	FILE_OBJECT_TYPE,
	OPEN_URL_TOOL_ID,
	URL_OBJECT_TYPE,
} from "./index";

describe("kilo.browser manifest", () => {
	const discover = () =>
		discoverPlugins(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
				{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
				{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
				{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
				{ manifest, definitions: BROWSER_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts and those of the kernel, kilo.core, kilo.shell, kilo.work-sessions and kilo.chat", () => {
		expect(discover().issues).toEqual([]);
	});

	const contributions = (point: `${string}/${string}`) =>
		discover().plugins.find((plugin) => plugin.manifest.id === BROWSER_PLUGIN_ID)!.manifest
			.contributes!.extensions![point]!;

	const keys = (point: `${string}/${string}`) =>
		contributions(point).map((entry) => `${BROWSER_PLUGIN_ID}/${String(entry.id)}`);

	it("contributes the pane kind, command and telemetry event its contracts name", () => {
		expect(keys("kilo.work-sessions/pane-kind")).toEqual([BROWSER_PANE_KIND]);
		expect(contributions("kilo.work-sessions/pane-kind")[0]).toMatchObject({
			openCommand: BROWSER_COMMANDS.openBrowser,
		});
		expect(keys("kernel/command")).toEqual(Object.values(BROWSER_COMMANDS));
		expect(contributions("kernel/telemetry-event").map((entry) => entry.id)).toEqual(
			Object.values(BROWSER_TELEMETRY_EVENTS),
		);
	});

	it("opens web pages and a workspace's HTML files", () => {
		expect(
			contributions("kilo.work-sessions/opener").map(({ match, pane }) => ({ match, pane })),
		).toEqual([
			{ match: { type: URL_OBJECT_TYPE }, pane: BROWSER_PANE_KIND },
			{ match: { type: FILE_OBJECT_TYPE, pattern: "*.html" }, pane: BROWSER_PANE_KIND },
			{ match: { type: FILE_OBJECT_TYPE, pattern: "*.htm" }, pane: BROWSER_PANE_KIND },
		]);
	});

	it("keeps origin's wire name for its agent tool, not offered to external apps", () => {
		expect(keys("kilo.core/tool")).toEqual([`${BROWSER_PLUGIN_ID}/${OPEN_URL_TOOL_ID}`]);
		expect(contributions("kilo.core/tool")[0]).toMatchObject({ external: false });
		expect(toolWireName(`${BROWSER_PLUGIN_ID}/${OPEN_URL_TOOL_ID}`)).toBe("desktop_browser_open");
	});
});
