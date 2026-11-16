import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";

import manifest from "../../plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "./index";

describe("kilo.work-sessions manifest", () => {
	const discover = () =>
		discoverPlugins(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
				{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
				{ manifest, definitions: WORK_SESSIONS_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts, the kernel's, kilo.core's and kilo.shell's", () => {
		expect(discover().issues).toEqual([]);
	});

	it("resolves each collection's object type, and owns the file and URL types", () => {
		const { objectTypes } = discover();

		expect(objectTypes.get("kilo.work-sessions/workspace")?.collection).toBe(
			"kilo.work-sessions/workspaces",
		);
		expect(objectTypes.get("kilo.work-sessions/work-session")?.collection).toBe(
			"kilo.work-sessions/work-sessions",
		);
		expect(objectTypes.get("kilo.work-sessions/pane")?.collection).toBe("kilo.work-sessions/panes");
		expect(objectTypes.get("kilo.work-sessions/file")).toMatchObject({
			owner: "kilo.work-sessions",
		});
		expect(objectTypes.get("kilo.work-sessions/file")?.collection).toBeUndefined();
		expect(objectTypes.get("kilo.work-sessions/url")?.collection).toBeUndefined();
	});
});
