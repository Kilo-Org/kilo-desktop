import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import {
	PAGES_DEFINITIONS,
	PAGES_OPEN_COMMAND,
	PAGES_PANE_KIND,
	PAGES_PLUGIN_ID,
	PAGES_SERVICE_KEY,
} from "./index";

describe("kilo.pages manifest", () => {
	const discover = (withHosts = true) =>
		discoverPlugins(
			[
				...(withHosts
					? [
							{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
							{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
						]
					: []),
				{ manifest, definitions: PAGES_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts and those of the kernel, kilo.core and kilo.work-sessions", () => {
		// kilo.work-sessions' own kilo.shell contributions warn without kilo.shell; only ours count.
		expect(discover().issues.filter((issue) => issue.pluginId === PAGES_PLUGIN_ID)).toEqual([]);
	});

	it("loads without kilo.core or kilo.work-sessions", () => {
		const result = discover(false);

		expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual([PAGES_PLUGIN_ID]);
	});

	const keys = (point: `${string}/${string}`) =>
		discover()
			.plugins.find((plugin) => plugin.manifest.id === PAGES_PLUGIN_ID)!
			.manifest.contributes!.extensions![point]!.map(
				(entry) => `${PAGES_PLUGIN_ID}/${String(entry.id)}`,
			);

	it("contributes the pane kind, command and service its contracts name", () => {
		expect(keys("kilo.work-sessions/pane-kind")).toEqual([PAGES_PANE_KIND]);
		expect(keys("kernel/command")).toEqual([PAGES_OPEN_COMMAND]);
		expect(keys("kernel/service")).toEqual([PAGES_SERVICE_KEY]);
		expect(keys("kilo.core/mcp-server")).toEqual(["kilo.pages/pages-local"]);
		expect(keys("kilo.core/server-env")).toEqual(["kilo.pages/pages"]);
	});

	it("asks for the embedded browser host its pane's guest runs in", () => {
		expect(manifest.permissions.host).toEqual(["browser-host"]);
	});
});
