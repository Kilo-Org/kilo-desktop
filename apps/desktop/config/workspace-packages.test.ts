import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { listWorkspaceDirectories, listWorkspacePackageNames } from "$config/workspace-packages.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("listWorkspacePackageNames", () => {
	it("lists every workspace package by its published name", async () => {
		const names = await listWorkspacePackageNames(workspaceRoot);

		expect(names).toEqual(
			expect.arrayContaining([
				"@kilo-desktop/kernel",
				"@kilo-desktop/bundled-plugins",
				"@kilo-desktop/plugin-core",
				"@kilo-desktop/plugin-chat",
				"@kilo-desktop/react-opencode",
				"@kilo-desktop/example-hello",
			]),
		);
	});

	it("excludes the workspace root, which is never deployed as a dependency", async () => {
		const names = await listWorkspacePackageNames(workspaceRoot);

		expect(names).not.toContain("kilo-desktop");
	});
});

describe("workspace package licensing", () => {
	it("credits Anaconda, Inc. and points every manifest at the root LICENSE.md", async () => {
		const directories = await listWorkspaceDirectories(workspaceRoot);
		const rootLicense = path.join(workspaceRoot, "LICENSE.md");

		const mismatches = [];
		for (const directory of directories) {
			const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8")) as {
				author?: unknown;
				license?: unknown;
			};
			const licensePath = /^SEE LICENSE IN (.+)$/.exec(String(manifest.license))?.[1];
			const pointsAtRootLicense =
				licensePath !== undefined && path.resolve(directory, licensePath) === rootLicense;
			if (manifest.author !== "Anaconda, Inc." || !pointsAtRootLicense) {
				mismatches.push({
					package: path.relative(workspaceRoot, directory) || ".",
					author: manifest.author,
					license: manifest.license,
				});
			}
		}

		expect(directories.length).toBeGreaterThan(10);
		expect(mismatches).toEqual([]);
		await expect(readFile(rootLicense, "utf8")).resolves.toContain(
			"Open Core Ventures Source Available License (OCVSAL) version 1.0",
		);
	});
});
