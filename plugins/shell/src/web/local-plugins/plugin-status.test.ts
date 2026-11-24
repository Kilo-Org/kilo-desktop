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
			localPluginStatus(record({ status: "invalid", message: "No plugin.json" }), none),
		).toEqual({
			label: "Can't load",
			kind: "problem",
			message: "No plugin.json",
		});
		expect(localPluginStatus(record({ status: "failed", message: "boom" }), none)).toMatchObject({
			label: "Failed to load",
			message: "boom",
		});
	});

	it("says what happens at the next launch for a plugin that isn't loaded", () => {
		expect(localPluginStatus(record({ loaded: false }), none).label).toBe("Starts after restart");
		expect(localPluginStatus(record({ loaded: false, approved: false }), none).label).toBe(
			"Disabled",
		);
	});

	it("follows the kernel once the plugin is loaded", () => {
		expect(localPluginStatus(record(), { state: "active", errors: [] })).toEqual({
			label: "Active",
			kind: "active",
		});
		expect(localPluginStatus(record(), { state: "disabled", errors: [] }).label).toBe(
			"Turned off in Diagnostics",
		);
		expect(localPluginStatus(record(), { state: "activating", errors: [] }).label).toBe("Starting");
	});

	it("reports a plugin that loaded but failed to start, with the kernel's reason", () => {
		expect(
			localPluginStatus(record(), { state: "failed", errors: ["activate() threw: nope"] }),
		).toEqual({ label: "Failed to start", kind: "problem", message: "activate() threw: nope" });
		expect(
			localPluginStatus(record(), { state: "unresolved", errors: ["Needs kilo.ghost"] }),
		).toMatchObject({ label: "Can't start", message: "Needs kilo.ghost" });
	});

	it("says an active plugin whose permission was withdrawn stops after a restart", () => {
		expect(
			localPluginStatus(record({ approved: false }), { state: "active", errors: [] }).label,
		).toBe("Stops after restart");
	});
});
