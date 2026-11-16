import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
	renderThirdPartyNotices,
	writeAppLegalFiles,
	type ThirdPartyNoticesOptions,
} from "./third-party-notices.js";

const MIT_TEXT =
	"MIT License\n\nCopyright (c) 2024 Example Authors\n\nPermission is hereby granted…";
const RULE_LINE = "=".repeat(80);
const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { force: true, recursive: true })),
	);
});

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-notices-"));
	temporaryDirectories.push(directory);
	return directory;
}

async function writePackage(
	nodeModules: string,
	manifest: Record<string, unknown> & { name: string },
	files: Record<string, string> = {},
): Promise<string> {
	const directory = path.join(nodeModules, manifest.name);
	await mkdir(directory, { recursive: true });
	await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest));
	for (const [file, content] of Object.entries(files)) {
		await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
		await writeFile(path.join(directory, file), content);
	}
	return directory;
}

async function writeJson(file: string, value: unknown): Promise<string> {
	await mkdir(path.dirname(file), { recursive: true });
	await writeFile(file, JSON.stringify(value));
	return file;
}

async function fixture(): Promise<{ root: string; options: ThirdPartyNoticesOptions }> {
	const root = await temporaryDirectory();
	const electronLicense = path.join(root, "electron/LICENSE");
	await mkdir(path.dirname(electronLicense), { recursive: true });
	await writeFile(
		electronLicense,
		"Copyright (c) Electron contributors\nCopyright (c) GitHub Inc.",
	);
	return {
		root,
		options: {
			productName: "Kilo",
			bundleLicenseFiles: [],
			packageSearchRoots: [],
			shippedNodeModules: path.join(root, "shipped/node_modules"),
			workspacePackageNames: [],
			componentNotices: [],
			electron: { version: "45.1.0", licenseFile: electronLicense },
		},
	};
}

/** The block of the notices file that describes one component, up to the next one. */
function entryFor(notices: string, heading: string): string {
	const rule = "=".repeat(80);
	const start = notices.indexOf(`${rule}\n${heading}\n${rule}`);
	if (start === -1) throw new Error(`No entry for ${heading}`);
	const next = notices.indexOf(`\n${rule}\n`, start + heading.length + rule.length * 2 + 2);
	return notices.slice(start, next === -1 ? undefined : next);
}

describe("renderThirdPartyNotices", () => {
	it("lists every production package packed into the app with its license text", async () => {
		const { options } = await fixture();
		await writePackage(
			options.shippedNodeModules,
			{
				name: "left-pad",
				version: "1.3.0",
				license: "MIT",
				repository: { type: "git", url: "git+https://github.com/left-pad/left-pad.git" },
			},
			{ LICENSE: MIT_TEXT },
		);

		const entry = entryFor(await renderThirdPartyNotices(options), "left-pad 1.3.0");

		expect(entry).toContain("License: MIT");
		expect(entry).toContain("Source: https://github.com/left-pad/left-pad");
		expect(entry).toContain(MIT_TEXT);
	});

	it("lists packages bundled into the app's bundles with their license and NOTICE files", async () => {
		const { root, options } = await fixture();
		const searchRoot = path.join(root, "workspace/node_modules");
		await writePackage(
			searchRoot,
			{
				name: "@scope/widget",
				version: "2.0.0",
				license: "Apache-2.0",
				homepage: "https://widget.dev",
			},
			{
				"LICENSE.txt": "Apache License\nVersion 2.0",
				NOTICE: "Widget\nCopyright 2025 Widget Corp",
			},
		);
		const bundle = await writeJson(path.join(root, "web/.vite/licenses.json"), [
			{ name: "@scope/widget", version: "2.0.0", identifier: "Apache-2.0", text: "Apache License" },
		]);

		const entry = entryFor(
			await renderThirdPartyNotices({
				...options,
				bundleLicenseFiles: [bundle],
				packageSearchRoots: [searchRoot],
			}),
			"@scope/widget 2.0.0",
		);

		expect(entry).toContain("License: Apache-2.0");
		expect(entry).toContain("Source: https://widget.dev");
		expect(entry).toContain("---- LICENSE.txt ----\n\nApache License\nVersion 2.0");
		expect(entry).toContain("---- NOTICE ----\n\nWidget\nCopyright 2025 Widget Corp");
	});

	it("includes the third-party notices a package ships for what it bundles", async () => {
		const { options } = await fixture();
		await writePackage(
			options.shippedNodeModules,
			{ name: "cli", version: "1.0.0", license: "MIT" },
			{
				"LICENSE.md": MIT_TEXT,
				"THIRD_PARTY_LICENSES.md": "bundled-dep 2.0.0 (ISC)",
				"lib/ThirdPartyNotices.txt": "ignored: the root already has legal files",
				"license.js": "module.exports = 'not a license';",
			},
		);
		await writePackage(
			options.shippedNodeModules,
			{ name: "wasm-table", version: "0.6.0", license: "BSD-3-Clause" },
			{ "lib/LICENSE": "BSD 3-Clause", "lib/THIRD_PARTY_NOTICES.md": "arrow (Apache-2.0)" },
		);

		const notices = await renderThirdPartyNotices(options);

		const cli = entryFor(notices, "cli 1.0.0");
		expect(cli).toContain("---- THIRD_PARTY_LICENSES.md ----\n\nbundled-dep 2.0.0 (ISC)");
		expect(cli).not.toContain("not a license");
		expect(cli).not.toContain("ignored");
		expect(entryFor(notices, "wasm-table 0.6.0")).toContain(
			"---- lib/THIRD_PARTY_NOTICES.md ----\n\narrow (Apache-2.0)",
		);
	});

	it("keeps what the bundler recorded when the package is not on disk", async () => {
		const { root, options } = await fixture();
		const bundle = await writeJson(path.join(root, "main/licenses.main.json"), [
			{ name: "gone", version: "1.0.0", identifier: "ISC", text: "ISC License text" },
		]);

		const entry = entryFor(
			await renderThirdPartyNotices({ ...options, bundleLicenseFiles: [bundle] }),
			"gone 1.0.0",
		);

		expect(entry).toContain("License: ISC");
		expect(entry).toContain("ISC License text");
	});

	it("lists a package once when it is both bundled and packed", async () => {
		const { root, options } = await fixture();
		await writePackage(
			options.shippedNodeModules,
			{ name: "zod", version: "4.6.7", license: "MIT" },
			{ LICENSE: MIT_TEXT },
		);
		const bundle = await writeJson(path.join(root, "web/licenses.json"), [
			{ name: "zod", version: "4.6.7", identifier: "MIT", text: MIT_TEXT },
		]);

		const notices = await renderThirdPartyNotices({ ...options, bundleLicenseFiles: [bundle] });

		expect(notices.split(`\nzod 4.6.7\n`)).toHaveLength(2);
	});

	it("skips the versionless manifests packages keep in subfolders", async () => {
		const { root, options } = await fixture();
		// preact/hooks/package.json is named "preact-hooks" and has no version;
		// Vite reports it as preact-hooks@0.0.0 next to preact itself.
		const bundle = await writeJson(path.join(root, "web/licenses.json"), [
			{ name: "preact", version: "11.0.0", identifier: "MIT", text: MIT_TEXT },
			{ name: "preact-hooks", version: "0.0.0", identifier: "MIT" },
		]);

		const notices = await renderThirdPartyNotices({ ...options, bundleLicenseFiles: [bundle] });

		expect(notices).toContain("\npreact 11.0.0\n");
		expect(notices).not.toContain("preact-hooks");
	});

	it("says so when a package ships no license text", async () => {
		const { options } = await fixture();
		await writePackage(options.shippedNodeModules, {
			name: "bare",
			version: "0.1.0",
			license: "MIT",
		});

		const entry = entryFor(await renderThirdPartyNotices(options), "bare 0.1.0");

		expect(entry).toContain("License text: not included in the package");
	});

	it("never lists first-party workspace packages as third-party software", async () => {
		const { options } = await fixture();
		await writePackage(options.shippedNodeModules, {
			name: "@kilo-desktop/plugin-git",
			version: "0.1.0",
		});

		const notices = await renderThirdPartyNotices({
			...options,
			workspacePackageNames: ["@kilo-desktop/plugin-git"],
		});

		expect(notices).not.toContain("@kilo-desktop/plugin-git 0.1.0");
	});

	it("reproduces the notices of every packed workspace package for the code it ported", async () => {
		const { options } = await fixture();
		await writePackage(
			options.shippedNodeModules,
			{ name: "@kilo-desktop/plugin-git", version: "0.1.0" },
			{ "THIRD_PARTY_NOTICES.md": "# Third-party notices\r\n\r\n## GitHub Desktop\r\n\r\nMIT\r\n" },
		);
		await writePackage(options.shippedNodeModules, {
			name: "@kilo-desktop/kernel",
			version: "0.1.0",
		});

		const notices = await renderThirdPartyNotices({
			...options,
			workspacePackageNames: ["@kilo-desktop/plugin-git", "@kilo-desktop/kernel"],
		});

		expect(entryFor(notices, "Ported source code: @kilo-desktop/plugin-git")).toContain(
			"# Third-party notices\n\n## GitHub Desktop\n\nMIT",
		);
		expect(notices).not.toContain("@kilo-desktop/kernel");
	});

	it("reproduces a shipped component's own notices after its preamble", async () => {
		const { root, options } = await fixture();
		const file = path.join(root, "bridge/THIRD_PARTY_NOTICES");
		await mkdir(path.dirname(file), { recursive: true });
		await writeFile(file, "THIRD-PARTY SOFTWARE NOTICES\nfrozendict 2.4.7\nLicense: LGPL-3.0");

		const entry = entryFor(
			await renderThirdPartyNotices({
				...options,
				componentNotices: [
					{ title: "Conda bridge", preamble: "GNU texts are in bridge/licenses/.", file },
				],
			}),
			"Conda bridge",
		);

		expect(entry).toContain("GNU texts are in bridge/licenses/.");
		expect(entry).toContain("frozendict 2.4.7\nLicense: LGPL-3.0");
	});

	it("credits Electron and points at the Chromium credits it ships", async () => {
		const { options } = await fixture();

		const entry = entryFor(await renderThirdPartyNotices(options), "Electron 45.1.0");

		expect(entry).toContain("License: MIT");
		expect(entry).toContain("Copyright (c) Electron contributors");
		expect(entry).toContain("LICENSES.chromium.html");
	});

	it("opens with a table of contents and renders byte-identically on every run", async () => {
		const { options } = await fixture();
		await writePackage(options.shippedNodeModules, { name: "b", version: "1.0.0", license: "MIT" });
		await writePackage(options.shippedNodeModules, { name: "a", version: "2.0.0", license: "ISC" });

		const first = await renderThirdPartyNotices(options);

		expect(first).toBe(await renderThirdPartyNotices(options));
		expect(first.indexOf("\na 2.0.0\n")).toBeLessThan(first.indexOf("\nb 1.0.0\n"));
		const contents = first.slice(0, first.indexOf(RULE_LINE));
		expect(contents).toMatch(/a\s+2\.0\.0\s+ISC/);
		expect(contents).toMatch(/Electron\s+45\.1\.0\s+MIT/);
		expect(first).not.toContain("\r");
	});

	it("fails when a bundle's license list is missing, rather than dropping its packages", async () => {
		const { root, options } = await fixture();

		await expect(
			renderThirdPartyNotices({
				...options,
				bundleLicenseFiles: [path.join(root, "web/.vite/licenses.json")],
			}),
		).rejects.toThrow(/licenses\.json/);
	});
});

describe("writeAppLegalFiles", () => {
	/** The layout @electron/packager extracts Electron into before it renames the app. */
	async function stageElectron(platform: string): Promise<{ root: string; buildPath: string }> {
		const root = await temporaryDirectory();
		const buildPath =
			platform === "darwin"
				? path.join(root, "Electron.app/Contents/Resources/app")
				: path.join(root, "resources/app");
		await mkdir(path.join(buildPath, "node_modules"), { recursive: true });
		await writeFile(path.join(root, "LICENSE"), "Copyright (c) Electron contributors");
		await writeFile(path.join(root, "LICENSES.chromium.html"), "<html>Chromium credits</html>");
		await writeFile(path.join(root, "version"), "45.1.0");
		return { root, buildPath };
	}

	it.each(["darwin", "win32", "linux"] as const)(
		"writes the notices and Chromium's credits beside app.asar on %s",
		async (platform) => {
			const { buildPath } = await stageElectron(platform);

			await writeAppLegalFiles({
				buildPath,
				platform,
				productName: "Kilo",
				bundleLicenseFiles: [],
				packageSearchRoots: [],
				workspacePackageNames: [],
				componentNotices: [],
			});

			const resources = path.dirname(buildPath);
			// The repository's license covers the source code, not the built app.
			await expect(readdir(resources)).resolves.not.toContain("LICENSE.md");
			await expect(readFile(path.join(resources, "LICENSES.chromium.html"), "utf8")).resolves.toBe(
				"<html>Chromium credits</html>",
			);
			const notices = await readFile(path.join(resources, "THIRD_PARTY_NOTICES.txt"), "utf8");
			expect(notices).toContain("Electron 45.1.0");
			expect(notices).toContain("Copyright (c) Electron contributors");
		},
	);
});
