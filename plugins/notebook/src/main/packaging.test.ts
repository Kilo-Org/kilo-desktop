import path from "node:path";

import { describe, expect, it } from "vitest";

import { createNotebookPackagingPlan, NOTEBOOK_MAIN_EXTERNALS } from "./packaging.js";

describe("notebook packaging", () => {
	it("keeps the notebook bundle mandatory and skips runt on unsupported targets", () => {
		const pluginRoot = path.resolve("/plugin/notebook");
		const required = new Set([
			path.join(pluginRoot, "build/notebook/index.html"),
			path.join(pluginRoot, "build/notebook/agentic-notebook-build.json"),
		]);

		expect(
			createNotebookPackagingPlan({
				pluginRoot,
				platform: "win32",
				arch: "x64",
				exists: (candidate) => required.has(candidate),
			}),
		).toEqual({
			extraResources: [path.join(pluginRoot, "build/notebook")],
			asarUnpackPackages: ["@runtimed"],
		});
	});

	it("fails before packaging when a required plugin asset is absent", () => {
		expect(() =>
			createNotebookPackagingPlan({
				pluginRoot: path.resolve("/plugin/notebook"),
				platform: "win32",
				arch: "x64",
				exists: () => false,
			}),
		).toThrow(/notebook plugin's prepare-assets script/);
	});

	it("declares the native adapter as a main-process external", () => {
		expect(NOTEBOOK_MAIN_EXTERNALS[0].test("@runtimed/node/electron")).toBe(true);
	});
});
