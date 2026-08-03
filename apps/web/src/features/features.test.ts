import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SHELL_ROUTE_PATHS } from "./features";

/**
 * SHELL_ROUTE_PATHS must mirror the generated route tree (it cannot import
 * routeTree.gen directly — that would create an import cycle through the
 * route components). This test reads the generated file as text so drift
 * fails fast: a new shell route file must also be added to the reserved list,
 * or a plugin could silently claim its path.
 */
describe("SHELL_ROUTE_PATHS", () => {
	it("matches the shell-owned paths in routeTree.gen.ts", () => {
		const routeTreePath = fileURLToPath(new URL("../routeTree.gen.ts", import.meta.url));
		const source = readFileSync(routeTreePath, "utf8");

		const fullPathsLine = /fullPaths:\s*(.+)/.exec(source)?.[1];
		expect(fullPathsLine).toBeDefined();

		const generatedPaths = [...fullPathsLine!.matchAll(/'([^']+)'/g)]
			.map((match) => match[1]!)
			// "/plugins/$" is the plugin catch-all — the one route plugins resolve through.
			.filter((path) => path !== "/plugins/$")
			.sort();

		expect([...SHELL_ROUTE_PATHS].sort()).toEqual(generatedPaths);
	});
});
