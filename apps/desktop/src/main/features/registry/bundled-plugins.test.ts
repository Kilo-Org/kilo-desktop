import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parsePluginManifest } from "@kilo-desktop/feature-sdk";

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
 * manifest is registered on both sides. Desktop-side manifest ids come from
 * `bundled-plugin-manifests.ts` (the single home of the plugin.json imports)
 * and main-entry registration from this registry's `/main` imports.
 */
describe("BUNDLED_PLUGINS parity", () => {
	const here = (relative: string): string => fileURLToPath(new URL(relative, import.meta.url));

	const manifestSpecifier = /@kilo-desktop\/plugin-([a-z0-9-]+)\/plugin\.json/g;
	const mainSpecifier = /@kilo-desktop\/plugin-([a-z0-9-]+)\/main/g;

	function matchedIds(source: string, pattern: RegExp): Set<string> {
		return new Set([...source.matchAll(pattern)].map((match) => match[1]!));
	}

	it("registers every dual-entry plugin in both the desktop and web registries", () => {
		const desktopManifestIds = matchedIds(
			readFileSync(here("./bundled-plugin-manifests.ts"), "utf8"),
			manifestSpecifier,
		);
		const desktopMainIds = matchedIds(
			readFileSync(here("./bundled-plugins.ts"), "utf8"),
			mainSpecifier,
		);
		const webIds = matchedIds(
			readFileSync(here("../../../../../web/src/features/bundled-plugins.ts"), "utf8"),
			manifestSpecifier,
		);

		const allIds = [...new Set([...desktopManifestIds, ...webIds])].sort();
		expect(allIds.length).toBeGreaterThan(0);
		expect(desktopManifestIds).toEqual(new Set([...desktopMainIds]));

		for (const id of allIds) {
			const manifest = parsePluginManifest(
				JSON.parse(readFileSync(here(`../../../../../../plugins/${id}/plugin.json`), "utf8")),
			);

			if (manifest.main !== undefined) {
				expect(
					desktopMainIds,
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
