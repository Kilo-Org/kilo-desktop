import { describe, expect, it } from "vitest";

import { shellMethods } from "./features/shell.js";
import { themeEvents, themeMethods } from "./features/theme.js";
import { todoMethods } from "./features/todos.js";
import { ipcEvents, ipcMethods, mergeChannelMaps } from "./registry.js";

describe("IPC registry", () => {
	it("merged method channel count equals the sum of feature parts", () => {
		expect(Object.keys(ipcMethods)).toHaveLength(
			Object.keys(shellMethods).length +
				Object.keys(themeMethods).length +
				Object.keys(todoMethods).length,
		);
	});

	it("merged event channel count equals the sum of feature parts", () => {
		expect(Object.keys(ipcEvents)).toHaveLength(Object.keys(themeEvents).length);
	});

	it("throws on duplicate channel keys", () => {
		expect(() => mergeChannelMaps({ "todos:list": 1 }, { "todos:list": 2 })).toThrow(
			"Duplicate IPC channel key: todos:list",
		);
	});
});
