import path from "node:path";

import { describe, expect, it } from "vitest";

import { NTERACT_MCP_ARTIFACTS, RUNTIMED_ARTIFACTS } from "./artifacts.js";
import { createNotebookPackagingPlan, NOTEBOOK_MAIN_EXTERNALS } from "./index.js";

describe("notebook packaging", () => {
	it("keeps the complete Windows notebook runtime mandatory", () => {
		const pluginRoot = path.resolve("/plugin/notebook");
		const required = new Set([
			path.join(pluginRoot, "build/notebook/index.html"),
			path.join(pluginRoot, "build/notebook/agentic-notebook-build.json"),
			path.join(pluginRoot, "resources/nteract-mcp/win32-x64/nteract-mcp.exe"),
			path.join(pluginRoot, "resources/nteract-mcp/win32-x64/runt.exe"),
			path.join(pluginRoot, "resources/nteract-mcp/win32-x64/staged.json"),
			path.join(pluginRoot, "resources/runtimed/win32-x64/runtimed.exe"),
			path.join(pluginRoot, "resources/runtimed/win32-x64/staged.json"),
		]);

		expect(
			createNotebookPackagingPlan({
				pluginRoot,
				platform: "win32",
				arch: "x64",
				exists: (candidate) => required.has(candidate),
			}),
		).toEqual({
			extraResources: [
				path.join(pluginRoot, "build/notebook"),
				path.join(pluginRoot, "resources/nteract-mcp"),
				path.join(pluginRoot, "resources/runtimed"),
			],
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

	it("keeps the Forge target layout aligned with every pinned runtimed artifact", () => {
		for (const artifact of RUNTIMED_ARTIFACTS) {
			const checkedPaths: string[] = [];
			createNotebookPackagingPlan({
				pluginRoot: path.resolve("/plugin/notebook"),
				platform: artifact.platform,
				arch: artifact.arch,
				exists: (candidate) => {
					checkedPaths.push(candidate);
					return true;
				},
			});
			expect(checkedPaths).toContain(
				path.resolve("/plugin/notebook/resources/runtimed", artifact.target, artifact.executable),
			);
		}
	});

	it("keeps nteract-mcp colocated with its runt child on every target", () => {
		for (const artifact of NTERACT_MCP_ARTIFACTS) {
			const checkedPaths: string[] = [];
			createNotebookPackagingPlan({
				pluginRoot: path.resolve("/plugin/notebook"),
				platform: artifact.platform,
				arch: artifact.arch,
				exists: (candidate) => {
					checkedPaths.push(candidate);
					return true;
				},
			});
			const targetRoot = path.resolve("/plugin/notebook/resources/nteract-mcp", artifact.target);
			expect(checkedPaths).toContain(path.join(targetRoot, artifact.nteractMcp.executable));
			expect(checkedPaths).toContain(path.join(targetRoot, artifact.runt.executable));
		}
	});

	it("rejects unsupported desktop targets before packaging", () => {
		expect(() =>
			createNotebookPackagingPlan({
				pluginRoot: path.resolve("/plugin/notebook"),
				platform: "linux",
				arch: "arm64",
				exists: () => true,
			}),
		).toThrow(/nteract-mcp is not configured for linux\/arm64/);
	});

	it("declares the native adapter as a main-process external", () => {
		expect(NOTEBOOK_MAIN_EXTERNALS[0].test("@runtimed/node/electron")).toBe(true);
	});

	it("resolves the installed plugin root when packaging options are omitted", () => {
		try {
			expect(createNotebookPackagingPlan().asarUnpackPackages).toEqual(["@runtimed"]);
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toMatch(/missing|not configured/);
		}
	});
});
