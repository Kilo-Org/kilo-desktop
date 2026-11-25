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
	NOTEBOOK_COMMANDS,
	NOTEBOOK_DEFINITIONS,
	NOTEBOOK_HOST,
	NOTEBOOK_KILO_PLUGIN_CONTRIBUTION,
	NOTEBOOK_PANE_KIND,
	NOTEBOOK_PLUGIN_ID,
	NOTEBOOK_SERVER_ENV_CONTRIBUTION,
	NOTEBOOK_TELEMETRY_FLAG,
	NOTEBOOK_TOOL_IDS,
	RUNTIMED_SERVICE_KEY,
} from "./index";

describe("kilo.notebook manifest", () => {
	const discover = () =>
		discoverPlugins(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
				{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
				{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
				{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
				{ manifest, definitions: NOTEBOOK_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts and those of the kernel, kilo.core, kilo.shell, kilo.work-sessions and kilo.chat", () => {
		expect(discover().issues).toEqual([]);
	});

	const contributions = (point: `${string}/${string}`) =>
		discover().plugins.find((plugin) => plugin.manifest.id === NOTEBOOK_PLUGIN_ID)!.manifest
			.contributes!.extensions![point]!;

	const keys = (point: `${string}/${string}`) =>
		contributions(point).map((entry) => `${NOTEBOOK_PLUGIN_ID}/${String(entry.id)}`);

	it("contributes the pane kind, opener, command, service and flag its contracts name", () => {
		expect(keys("kilo.work-sessions/pane-kind")).toEqual([NOTEBOOK_PANE_KIND]);
		expect(contributions("kilo.work-sessions/pane-kind")[0]).toMatchObject({
			openCommand: NOTEBOOK_COMMANDS.open,
		});
		expect(contributions("kilo.work-sessions/opener")[0]).toMatchObject({
			match: { type: FILE_OBJECT_TYPE, pattern: "*.ipynb" },
			pane: NOTEBOOK_PANE_KIND,
		});
		expect(keys("kernel/command")).toEqual(Object.values(NOTEBOOK_COMMANDS));
		expect(keys("kernel/service")).toEqual([RUNTIMED_SERVICE_KEY]);
		expect(contributions("kernel/flag").map((entry) => entry.id)).toEqual([
			NOTEBOOK_TELEMETRY_FLAG,
		]);
	});

	it("adds its Kilo plugin from its resources and gives the server its environment", () => {
		expect(contributions("kilo.core/agent-extension")).toEqual([
			expect.objectContaining({
				id: NOTEBOOK_KILO_PLUGIN_CONTRIBUTION,
				type: "kilo-plugin",
				path: "${resources}/kilo-plugin/index.js",
			}),
		]);
		expect(contributions("kilo.core/server-env").map((entry) => entry.id)).toEqual([
			NOTEBOOK_SERVER_ENV_CONTRIBUTION,
		]);
	});

	it("keeps origin's wire names for its agent tools, not offered to external apps", () => {
		expect(contributions("kilo.core/tool").map((entry) => entry.id)).toEqual([
			...NOTEBOOK_TOOL_IDS,
		]);
		for (const tool of contributions("kilo.core/tool")) {
			expect(tool).toMatchObject({ external: false, requiresSignIn: true });
		}
		expect(NOTEBOOK_TOOL_IDS.map((id) => toolWireName(`${NOTEBOOK_PLUGIN_ID}/${id}`))).toEqual([
			"desktop_notebook_list_open",
			"desktop_notebook_open",
			"desktop_notebook_open_file",
		]);
	});

	it("details the code-run permission its Kilo plugin asks for, matched on the permission name", () => {
		expect(contributions("kilo.chat/permission-renderer")).toEqual([
			{ id: "execute", actions: ["notebooks_execute"] },
		]);
	});

	it("may embed nteract's notebook UI", () => {
		expect(manifest.permissions.embeddedHosts).toEqual([NOTEBOOK_HOST]);
	});
});
