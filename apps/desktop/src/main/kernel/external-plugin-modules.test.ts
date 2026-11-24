import { describe, expect, it } from "vitest";

import { createPluginModuleHooks, sharedModuleSource } from "./external-plugin-modules.js";

describe("sharedModuleSource", () => {
	it("re-exports a shared instance's named and default exports", () => {
		const source = sharedModuleSource("zod", {
			z: {},
			object: () => {},
			default: {},
			"not-an-id": 1,
		});

		expect(source).toContain('globalThis[Symbol.for("kilo-desktop.plugin-shared-modules")]["zod"]');
		expect(source).toContain("export default shared.default ?? shared;");
		expect(source).toContain("export const { z, object } = shared;");
		expect(source).not.toContain("not-an-id");
	});
});

describe("createPluginModuleHooks", () => {
	const root = "file:///plugins/hello/";
	const files = new Map([
		["main.js", new TextEncoder().encode("export default {};")],
		["lib/util.js", new TextEncoder().encode("export const x = 1;")],
	]);
	const hooks = createPluginModuleHooks([{ root, files }]);
	const fromApp = () => ({ url: "file:///app/next.js" });
	const loadFromDisk = () => ({ format: "module", source: "from disk" });

	it("leaves the app's own imports alone", () => {
		expect(hooks.resolve("electron", "file:///app/main.js", fromApp)).toEqual(fromApp());
		expect(hooks.load("file:///app/main.js", loadFromDisk)).toEqual(loadFromDisk());
	});

	it("resolves a plugin's own approved files and shared modules", () => {
		expect(hooks.resolve("./lib/util.js", `${root}main.js`, fromApp)).toEqual({
			url: `${root}lib/util.js`,
			shortCircuit: true,
		});
		expect(hooks.resolve("zod", `${root}main.js`, fromApp)).toEqual({
			url: "kilo-plugin-shared:zod",
			shortCircuit: true,
		});
		expect(hooks.resolve("node:fs", `${root}main.js`, fromApp)).toEqual(fromApp());
	});

	it("loads plugin modules from the approved bytes, never from disk", () => {
		const loaded = hooks.load(`${root}main.js?v=abc`, loadFromDisk) as { source: Uint8Array };

		expect(new TextDecoder().decode(loaded.source)).toBe("export default {};");
		expect(() => hooks.load(`${root}written-later.js`, loadFromDisk)).toThrow(/approved files/);
	});

	it.each([
		["a file the digest skipped", "./node_modules/dep/index.js", /approved files/],
		["a file outside the plugin", "../other/main.js", /own files/],
		["a package it didn't bundle", "left-pad", /own files/],
	])("refuses %s", (_case, specifier, message) => {
		expect(() => hooks.resolve(specifier, `${root}main.js`, fromApp)).toThrow(message);
	});
});
