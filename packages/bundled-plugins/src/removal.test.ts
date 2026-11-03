import { describe, expect, it } from "vitest";

import { definePlugin } from "@kilo-desktop/kernel";

import { BUNDLED_PLUGINS } from "./plugins";
import type { BundledPlugin } from "./registrations";
import { entriesWithout, pluginRemovals } from "./removal";

const plugin = (id: string, requires: Record<string, string> = {}): BundledPlugin => ({
	manifest: { manifestVersion: 1, id, displayName: id, version: "1.0.0", requires },
});

const idsOf = (plugins: readonly BundledPlugin[]) =>
	plugins.map((entry) => (entry.manifest as { id: string }).id);

describe("pluginRemovals", () => {
	it("takes out plugins that require the removed one, transitively, but not optional users", () => {
		const plugins = [
			plugin("acme.base"),
			plugin("acme.middle", { "acme.base/thing": "required" }),
			plugin("acme.top", { "acme.middle/thing": "required" }),
			plugin("acme.optional", { "acme.base/thing": "optional" }),
		];

		const base = pluginRemovals(plugins).find((removal) => removal.removed === "acme.base");

		expect(base?.removedIds).toEqual(["acme.base", "acme.middle", "acme.top"]);
		expect(idsOf(base?.remaining ?? [])).toEqual(["acme.optional"]);
	});

	it("covers every bundled plugin and skips manifests that do not parse", () => {
		const removals = pluginRemovals([...BUNDLED_PLUGINS, { manifest: { broken: true } }]);

		expect(removals.map((removal) => removal.removed)).toEqual(idsOf(BUNDLED_PLUGINS));
	});
});

describe("entriesWithout", () => {
	it("drops the entries of removed plugins", () => {
		const entry = definePlugin({ activate: () => {} });

		expect(entriesWithout({ "acme.a": entry, "acme.b": entry }, ["acme.a"])).toEqual({
			"acme.b": entry,
		});
	});
});
