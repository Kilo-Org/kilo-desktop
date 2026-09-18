import { describe, expect, it, vi } from "vitest";

const { fetch, handle, registerSchemesAsPrivileged, unhandle } = vi.hoisted(() => ({
	fetch: vi.fn(),
	handle: vi.fn(),
	registerSchemesAsPrivileged: vi.fn(),
	unhandle: vi.fn(),
}));

vi.mock("electron", () => ({
	net: { fetch },
	protocol: { handle, registerSchemesAsPrivileged, unhandle },
}));

import {
	BUNDLED_PLUGIN_MANIFESTS,
	PLUGIN_DEEP_LINKS,
	PLUGIN_PROTOCOLS_BY_FEATURE_ID,
	PLUGIN_PROTOCOL_SCHEMES,
	buildPluginDeepLinkIndex,
	buildPluginProtocolSchemeIndex,
} from "./bundled-plugin-manifests.js";

describe("buildPluginProtocolSchemeIndex", () => {
	it("accepts the current bundled manifests and exposes their schemes", () => {
		expect(PLUGIN_PROTOCOL_SCHEMES).toContain("kilo-git");
		expect(PLUGIN_PROTOCOLS_BY_FEATURE_ID.get("git")).toEqual(["kilo-git"]);
		expect(BUNDLED_PLUGIN_MANIFESTS.length).toBeGreaterThan(0);
	});

	it("rejects a reserved shell scheme", () => {
		expect(() =>
			buildPluginProtocolSchemeIndex([{ id: "evil", protocols: ["kilo-desktop"] }]),
		).toThrow(/reserved scheme "kilo-desktop"/);
		expect(() =>
			buildPluginProtocolSchemeIndex([{ id: "evil", protocols: ["kilo-desktop-dev"] }]),
		).toThrow(/reserved scheme "kilo-desktop-dev"/);
	});

	it("rejects the same scheme declared by two manifests", () => {
		expect(() =>
			buildPluginProtocolSchemeIndex([
				{ id: "alpha", protocols: ["shared-scheme"] },
				{ id: "beta", protocols: ["shared-scheme"] },
			]),
		).toThrow(/"alpha" and "beta" both declare the scheme "shared-scheme"/);
	});

	it("rejects the same scheme declared twice by one manifest", () => {
		expect(() =>
			buildPluginProtocolSchemeIndex([{ id: "alpha", protocols: ["dup", "dup"] }]),
		).toThrow(/"alpha" declares the scheme "dup" more than once/);
	});
});

describe("buildPluginDeepLinkIndex", () => {
	it("exposes deep links contributed by bundled manifests", () => {
		expect(PLUGIN_DEEP_LINKS).toContainEqual({
			host: "model-catalog",
			to: "/settings/local-model-server",
			searchParam: "catalogModel",
		});
	});

	it("rejects a reserved app host", () => {
		expect(() =>
			buildPluginDeepLinkIndex([
				{
					id: "evil",
					contributes: {
						deepLinks: [{ host: "app", to: "/settings/local-model-server", searchParam: "id" }],
					},
				},
			]),
		).toThrow(/reserved deep-link host "app"/);
	});

	it("rejects the same host declared by two manifests", () => {
		expect(() =>
			buildPluginDeepLinkIndex([
				{
					id: "alpha",
					contributes: {
						deepLinks: [{ host: "model-catalog", to: "/settings/alpha", searchParam: "id" }],
					},
				},
				{
					id: "beta",
					contributes: {
						deepLinks: [{ host: "model-catalog", to: "/settings/beta", searchParam: "id" }],
					},
				},
			]),
		).toThrow(/"alpha" and "beta" both declare the deep-link host "model-catalog"/);
	});
});
