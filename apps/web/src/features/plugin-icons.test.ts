import { describe, expect, it } from "vitest";

import { FALLBACK_PLUGIN_NAV_ICON, resolvePluginNavIcon } from "./plugin-icons";

describe("resolvePluginNavIcon", () => {
	it("uses iconComponent when provided (takes priority over icon name)", () => {
		const CustomIcon = () => null;
		expect(resolvePluginNavIcon("anything", CustomIcon)).toBe(CustomIcon);
	});

	it("falls back to icon name lookup when iconComponent is undefined", () => {
		// The static map is empty now (all bundled plugins export their icons),
		// so any string falls through to the fallback.
		expect(resolvePluginNavIcon("not-a-registered-icon")).toBe(FALLBACK_PLUGIN_NAV_ICON);
	});

	it("falls back to PuzzleIcon when both iconComponent is undefined and name is unknown", () => {
		expect(resolvePluginNavIcon("unknown-icon", undefined)).toBe(FALLBACK_PLUGIN_NAV_ICON);
	});

	it("falls back to PuzzleIcon when name is undefined and no component", () => {
		expect(resolvePluginNavIcon(undefined)).toBe(FALLBACK_PLUGIN_NAV_ICON);
		expect(resolvePluginNavIcon(undefined, undefined)).toBe(FALLBACK_PLUGIN_NAV_ICON);
	});
});
