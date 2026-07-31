import { describe, expect, it } from "vitest";

import { featureMethods } from "./features/feature-invoke.js";
import { shellMethods } from "./features/shell.js";
import { themeMethods } from "./features/theme.js";
import { todoMethods } from "./features/todos.js";
import { ipcMethods, mergeChannelMaps } from "./registry.js";

describe("IPC registry", () => {
	it("merged method channel count equals the sum of feature parts", () => {
		expect(Object.keys(ipcMethods)).toHaveLength(
			Object.keys(shellMethods).length +
				Object.keys(themeMethods).length +
				Object.keys(todoMethods).length +
				Object.keys(featureMethods).length,
		);
	});

	it("throws on duplicate channel keys", () => {
		expect(() => mergeChannelMaps({ "todos:list": 1 }, { "todos:list": 2 })).toThrow(
			"Duplicate IPC channel key: todos:list",
		);
	});
});
