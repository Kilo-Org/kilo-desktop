import { describe, expect, it } from "vitest";

import { featureMethods } from "./features/feature-invoke.js";
import { shellMethods } from "./features/shell.js";
import { themeEvents, themeMethods } from "./features/theme.js";
import { ipcEvents, ipcMethods, mergeChannelMaps } from "./registry.js";

describe("IPC registry", () => {
	it("merged method channel count equals the sum of feature parts", () => {
		expect(Object.keys(ipcMethods)).toHaveLength(
			Object.keys(shellMethods).length +
				Object.keys(themeMethods).length +
				Object.keys(featureMethods).length,
		);
	});

	it("merged event channel count equals the sum of feature parts", () => {
		expect(Object.keys(ipcEvents)).toHaveLength(Object.keys(themeEvents).length);
	});

	it("throws on duplicate channel keys", () => {
		expect(() => mergeChannelMaps({ "demo:list": 1 }, { "demo:list": 2 })).toThrow(
			"Duplicate IPC channel key: demo:list",
		);
	});
});
