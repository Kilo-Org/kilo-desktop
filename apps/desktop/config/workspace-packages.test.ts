import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { listWorkspacePackageNames } from "$config/workspace-packages.js";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("listWorkspacePackageNames", () => {
	it("lists every workspace package by its published name, whatever its scope", async () => {
		const names = await listWorkspacePackageNames(workspaceRoot);

		expect(names).toEqual(
			expect.arrayContaining([
				"@kilo-desktop/kernel",
				"@kilo-desktop/bundled-plugins",
				"@kilo-desktop/plugin-core",
				"@kilo-desktop/plugin-chat",
				"@opencode-ai/sdk",
				"@kilo-desktop/example-hello",
			]),
		);
	});

	it("excludes the workspace root, which is never deployed as a dependency", async () => {
		const names = await listWorkspacePackageNames(workspaceRoot);

		expect(names).not.toContain("kilo-desktop");
	});
});
