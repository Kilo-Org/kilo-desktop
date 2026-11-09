import { describe, expect, it } from "vitest";

import { definePlugin } from "@kilo-desktop/kernel";

import { protocolSchemes, webPluginIds, withEntries, type BundledPlugin } from "./registrations";

const manifest = (id: string, extra: Record<string, unknown> = {}) => ({
	manifestVersion: 1,
	id,
	displayName: id,
	version: "1.0.0",
	...extra,
});

describe("withEntries", () => {
	it("attaches each process's entry to its bundled plugin by id", () => {
		const entry = definePlugin({ activate: () => {} });
		const plugins: BundledPlugin[] = [
			{ manifest: manifest("acme.a") },
			{ manifest: manifest("acme.b") },
		];

		const registrations = withEntries({ "acme.b": entry }, plugins);

		expect(registrations).toEqual([
			{ manifest: manifest("acme.a"), source: "bundled" },
			{ manifest: manifest("acme.b"), source: "bundled", entry },
		]);
	});

	it("carries contracts definitions through and passes manifests without an id to the kernel to reject", () => {
		const definitions = { extensionPoints: [] };
		const plugins: BundledPlugin[] = [
			{ manifest: manifest("acme.a"), definitions },
			{ manifest: { broken: true } },
		];

		expect(withEntries({}, plugins)).toEqual([
			{ manifest: manifest("acme.a"), definitions, source: "bundled" },
			{ manifest: { broken: true }, source: "bundled" },
		]);
	});

	it("refuses an entry for a plugin that is not bundled", () => {
		expect(() => withEntries({ "acme.ghost": definePlugin({ activate: () => {} }) }, [])).toThrow(
			/acme\.ghost/,
		);
	});
});

describe("protocolSchemes", () => {
	it("collects schemes from valid manifests only", () => {
		const plugins: BundledPlugin[] = [
			{ manifest: manifest("acme.a", { permissions: { protocols: ["acme-file"] } }) },
			{ manifest: { id: "broken", permissions: { protocols: ["evil"] } } },
		];

		expect(protocolSchemes(plugins)).toEqual(["acme-file"]);
	});
});

describe("webPluginIds", () => {
	it("lists every bundled plugin except main-only ones", () => {
		const plugins: BundledPlugin[] = [
			{ manifest: manifest("acme.a") },
			{ manifest: manifest("acme.main"), mainOnly: true },
			{ manifest: { broken: true } },
		];

		expect(webPluginIds(plugins)).toEqual(["acme.a"]);
	});
});
