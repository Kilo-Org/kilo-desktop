import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";

import manifest from "../../plugin.json";
import { WORKBOOKS_DEFINITIONS, WORKBOOKS_FEATURE_FLAG, WORKBOOKS_PLUGIN_ID } from "./index";

describe("kilo.workbooks manifest", () => {
	const discover = () =>
		discoverPlugins([{ manifest, definitions: WORKBOOKS_DEFINITIONS }], {
			kernelDefinitions: KERNEL_DEFINITIONS,
			kernelContextKeys: KERNEL_CONTEXT_KEYS,
		});

	it("agrees with its contracts and the kernel's", () => {
		expect(discover().issues).toEqual([]);
		expect(manifest.id).toBe(WORKBOOKS_PLUGIN_ID);
	});

	it("declares its feature flag, off by default", () => {
		const flags = discover().plugins.find((plugin) => plugin.manifest.id === WORKBOOKS_PLUGIN_ID)!
			.manifest.contributes!.extensions!["kernel/flag"]!;
		expect(flags).toEqual([
			expect.objectContaining({ id: WORKBOOKS_FEATURE_FLAG, default: false }),
		]);
	});
});
