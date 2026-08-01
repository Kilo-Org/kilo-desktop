import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parsePluginManifest } from "@anaconda-agentic-desktop/feature-sdk";

/**
 * BUNDLED_PLUGINS is intentionally split per process (this file for Electron
 * main, apps/web/src/features/bundled-plugins.ts for the renderer) because
 * each side may only import the entry it can run. The split has a failure
 * mode with no discovery issue: a dual-entry plugin registered on the web
 * side but forgotten here renders a live page and nav entry whose every
 * sdk.invoke fails at runtime (and vice versa, a silently headless backend).
 *
 * This test compares the two registry SOURCES (imports would drag renderer
 * code into the main-process test) and asserts every dual-entry plugin
 * manifest is registered on both sides.
 */
describe("BUNDLED_PLUGINS parity", () => {
	const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

	const manifestSpecifier = /@anaconda-agentic-desktop\/plugin-([a-z0-9-]+)\/plugin\.json/g;

	function registeredPluginIds(registrySource: string): Set<string> {
		return new Set([...registrySource.matchAll(manifestSpecifier)].map((match) => match[1]!));
	}

	it("registers every dual-entry plugin in both the desktop and web registries", () => {
		const desktopIds = registeredPluginIds(readFileSync(here("./bundled-plugins.ts"), "utf8"));
		const webIds = registeredPluginIds(
			readFileSync(here("../../../../../web/src/features/bundled-plugins.ts"), "utf8"),
		);

		const allIds = [...new Set([...desktopIds, ...webIds])].sort();
		expect(allIds.length).toBeGreaterThan(0);

		for (const id of allIds) {
			const manifest = parsePluginManifest(
				JSON.parse(readFileSync(here(`../../../../../../plugins/${id}/plugin.json`), "utf8")),
			);

			if (manifest.main !== undefined) {
				expect(
					desktopIds,
					`plugin "${id}" declares "main" but is missing from the desktop
	registry (apps/desktop/src/main/features/registry/bundled-plugins.ts)`,
				).toContain(id);
			}
			if (manifest.web !== undefined) {
				expect(
					webIds,
					`plugin "${id}" declares "web" but is missing from the web registry
	(apps/web/src/features/bundled-plugins.ts)`,
				).toContain(id);
			}
		}
	});
});
