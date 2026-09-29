import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { RUNTIMED_ARTIFACTS } from "./artifacts.js";
import {
	createNotebookPackagingPlan,
	NOTEBOOK_ASAR_UNPACK_PACKAGES,
	NOTEBOOK_MAIN_EXTERNALS,
} from "./index.js";

const require = createRequire(import.meta.url);

type PackageManifest = { name?: string; dependencies?: Record<string, string> };

// Walks up from the resolved entry because the package's `exports` hides package.json.
function runtimeDependenciesOf(packageName: string): string[] {
	let directory = path.dirname(require.resolve(packageName));
	while (directory !== path.dirname(directory)) {
		const manifestPath = path.join(directory, "package.json");
		if (existsSync(manifestPath)) {
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PackageManifest;
			if (manifest.name === packageName) return Object.keys(manifest.dependencies ?? {});
		}
		directory = path.dirname(directory);
	}
	throw new Error(`Could not find the package.json for ${packageName}`);
}

describe("notebook packaging", () => {
	it("keeps the fetched notebook UI, direct Kilo plugin, and Windows daemon mandatory", () => {
		const pluginRoot = path.resolve("/plugin/notebook");
		const required = new Set([
			path.join(pluginRoot, "build/notebook/index.html"),
			path.join(pluginRoot, "build/notebook/staged.json"),
			path.join(pluginRoot, "build/kilo-plugin/index.js"),
			path.join(pluginRoot, "resources/runtimed/win32-x64/runtimed-nightly.exe"),
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
				path.join(pluginRoot, "build/kilo-plugin"),
				path.join(pluginRoot, "resources/runtimed"),
			],
			asarUnpackPackages: NOTEBOOK_ASAR_UNPACK_PACKAGES,
		});
	});

	it("unpacks every runtime dependency of @runtimed/node for the ASAR-blind Kilo server", () => {
		// The Kilo server is not Electron, so it cannot resolve modules left in app.asar.
		const unpackedPackages = new Set<string>(NOTEBOOK_ASAR_UNPACK_PACKAGES);
		for (const dependency of runtimeDependenciesOf("@runtimed/node")) {
			const scope = dependency.startsWith("@") ? dependency.split("/")[0]! : undefined;
			expect(
				unpackedPackages.has(dependency) || (scope !== undefined && unpackedPackages.has(scope)),
				`${dependency} must be unpacked from ASAR`,
			).toBe(true);
		}
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

	it("rejects unsupported desktop targets before packaging", () => {
		expect(() =>
			createNotebookPackagingPlan({
				pluginRoot: path.resolve("/plugin/notebook"),
				platform: "win32",
				arch: "arm64",
				exists: () => true,
			}),
		).toThrow(/runtimed is not configured for win32\/arm64/);
	});

	it("unpacks koffi's sibling addon package so the native binding survives packaging", () => {
		// koffi ships no addon itself; it requires koffi.node from
		// @koromix/koffi-<platform>-<arch>, which hoists to the top level under
		// the hoisted node linker. Missing it leaves the addon inside app.asar and
		// silently disables daemon peer authentication in packaged builds.
		expect(NOTEBOOK_ASAR_UNPACK_PACKAGES).toContain("@koromix");
		expect(NOTEBOOK_ASAR_UNPACK_PACKAGES).toContain("koffi");
	});

	it("declares the native adapter as a main-process external", () => {
		expect(NOTEBOOK_MAIN_EXTERNALS[0].test("@runtimed/node/electron")).toBe(true);
	});

	it("declares koffi as a main-process external so its native addon is not bundled", () => {
		expect(NOTEBOOK_MAIN_EXTERNALS.some((pattern) => pattern.test("koffi"))).toBe(true);
	});

	it("resolves the installed plugin root when packaging options are omitted", () => {
		try {
			expect(createNotebookPackagingPlan().asarUnpackPackages).toEqual(
				NOTEBOOK_ASAR_UNPACK_PACKAGES,
			);
		} catch (error) {
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toMatch(/missing|not configured/);
		}
	});
});
