import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";

import manifest from "../../plugin.json";
import { SHELL_DEFINITIONS } from "./index";

describe("kilo.shell manifest", () => {
	it("agrees with its contracts, the kernel's and kilo.core's", () => {
		const result = discoverPlugins(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
				{ manifest, definitions: SHELL_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

		expect(result.issues).toEqual([]);
	});
});
