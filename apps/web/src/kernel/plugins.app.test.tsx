import { describe, expect, it } from "vitest";

import { BUNDLED_PLUGINS, webPluginIds } from "@kilo-desktop/bundled-plugins";

import { WEB_ENTRIES } from "./plugins";

describe("WEB_ENTRIES", () => {
	// Desktop main can't import renderer entries, so it trusts `mainOnly` to know
	// which plugins a window may call main as. A drift here locks a plugin's UI
	// out of main (missing id) or lets a window impersonate a main-only plugin.
	it("matches the bundled plugins not marked mainOnly", () => {
		expect(Object.keys(WEB_ENTRIES).sort()).toEqual(webPluginIds(BUNDLED_PLUGINS).sort());
	});
});
