import { describe, expect, it, vi } from "vitest";

import { EXTERNAL_PLUGINS_CHANNEL } from "@kilo-desktop/kernel";

import { externalPluginRegistrations } from "./external-plugins";

const entry = { activate: () => {} };
const definitions = { domainObjects: [] };

function modules(table: Record<string, unknown>) {
	return vi.fn(async (url: string) => {
		if (!(url in table)) throw new Error(`Failed to fetch ${url}`);
		return table[url];
	});
}

describe("externalPluginRegistrations", () => {
	it("imports each local plugin's contracts and window entry from main's list", async () => {
		const request = vi.fn(async () => [
			{ manifest: { id: "acme.both" }, contracts: "/c.js", web: "/w.js" },
			{ manifest: { id: "acme.main-only" } },
		]);

		const registrations = await externalPluginRegistrations({
			request,
			logger: { error: vi.fn() },
			importModule: modules({ "/c.js": { definitions }, "/w.js": { default: entry } }),
		});

		expect(request).toHaveBeenCalledWith(EXTERNAL_PLUGINS_CHANNEL, null);
		expect(registrations).toEqual([
			{ manifest: { id: "acme.both" }, source: "external", definitions, entry },
			{ manifest: { id: "acme.main-only" }, source: "external" },
		]);
	});

	it("leaves out a plugin whose modules fail to load, and reports it", async () => {
		const logger = { error: vi.fn() };

		const registrations = await externalPluginRegistrations({
			request: async () => [
				{ manifest: { id: "acme.missing" }, web: "/gone.js" },
				{ manifest: { id: "acme.odd" }, web: "/odd.js" },
				{ manifest: { id: "acme.ok" }, web: "/ok.js" },
			],
			logger,
			importModule: modules({ "/odd.js": { default: 42 }, "/ok.js": { default: entry } }),
		});

		expect(registrations.map((registration) => registration.manifest)).toEqual([{ id: "acme.ok" }]);
		expect(logger.error).toHaveBeenCalledTimes(2);
	});

	it("loads none when main can't list them", async () => {
		const registrations = await externalPluginRegistrations({
			request: async () => {
				throw new Error("no handler");
			},
			logger: { error: vi.fn() },
		});

		expect(registrations).toEqual([]);
	});
});
