import { describe, expect, it } from "vitest";

import type { ExternalPluginRecord } from "@kilo-desktop/kernel";

import { localPluginStatus } from "./plugin-status";

function record(overrides: Partial<ExternalPluginRecord> = {}): ExternalPluginRecord {
	return {
		folder: "hello",
		id: "acme.hello",
		hash: "abc",
		status: "ready",
		approved: true,
		loaded: true,
		...overrides,
	};
}

const none = { errors: [] };

describe("localPluginStatus", () => {
	it("says why a plugin can't load before the kernel ever sees it", () => {
		expect(
			localPluginStatus(record({ status: "invalid", message: "No plugin.json" }), none, true),
		).toEqual({
			label: "Can't load",
			kind: "problem",
			message: "No plugin.json",
		});
		expect(
			localPluginStatus(record({ status: "failed", message: "boom" }), none, true),
		).toMatchObject({
			label: "Failed to load",
			message: "boom",
		});
	});

	it("says what happens at the next launch for a plugin that isn't loaded", () => {
		expect(localPluginStatus(record({ loaded: false }), none, true).label).toBe(
			"Starts after restart",
		);
		expect(localPluginStatus(record({ loaded: false, approved: false }), none, true).label).toBe(
			"Disabled",
		);
	});

	it("follows the kernel once the plugin is loaded", () => {
		expect(localPluginStatus(record(), { state: "active", errors: [] }, true)).toEqual({
			label: "Active",
			kind: "active",
		});
		expect(localPluginStatus(record(), { state: "disabled", errors: [] }, true).label).toBe(
			"Turned off in Diagnostics",
		);
		expect(localPluginStatus(record(), { state: "activating", errors: [] }, true).label).toBe(
			"Starting",
		);
	});

	it("reports a plugin that loaded but failed to start, with the kernel's reason", () => {
		expect(
			localPluginStatus(record(), { state: "failed", errors: ["activate() threw: nope"] }, true),
		).toEqual({ label: "Failed to start", kind: "problem", message: "activate() threw: nope" });
		expect(
			localPluginStatus(record(), { state: "unresolved", errors: ["Needs kilo.ghost"] }, true),
		).toMatchObject({ label: "Can't start", message: "Needs kilo.ghost" });
	});

	it("says an active plugin whose permission was withdrawn stops after a restart", () => {
		expect(
			localPluginStatus(record({ approved: false }), { state: "active", errors: [] }, true).label,
		).toBe("Stops after restart");
	});

	it("follows the Allow local plugins switch", () => {
		expect(localPluginStatus(record({ loaded: false }), none, false).label).toBe("Disabled");
		expect(localPluginStatus(record(), { state: "active", errors: [] }, false).label).toBe(
			"Stops after restart",
		);
	});
});
