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
	PLUGIN_PROTOCOLS_BY_FEATURE_ID,
	PLUGIN_PROTOCOL_SCHEMES,
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
			buildPluginProtocolSchemeIndex([{ id: "evil", protocols: ["anaconda-agentic-desktop"] }]),
		).toThrow(/reserved scheme "anaconda-agentic-desktop"/);
		expect(() =>
			buildPluginProtocolSchemeIndex([{ id: "evil", protocols: ["anaconda-agentic-desktop-dev"] }]),
		).toThrow(/reserved scheme "anaconda-agentic-desktop-dev"/);
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
