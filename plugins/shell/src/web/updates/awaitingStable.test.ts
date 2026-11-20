import { describe, expect, it } from "vitest";

import type { UpdaterState } from "@kilo-desktop/kernel";

import { awaitedStableVersion } from "./awaitingStable";

/** A Preview installation switched to Stable, with no newer Stable published yet. */
const waiting: UpdaterState = {
	enabled: true,
	status: "up-to-date",
	track: "stable",
	installedTrack: "preview",
	currentVersion: "1.2.3-preview-261118-10302",
	availableVersion: null,
	downloadedVersion: null,
	downloadUrl: null,
	checkedAt: "2026-11-19T12:00:00.000Z",
	message: null,
	releaseNotes: [],
};

describe("awaitedStableVersion", () => {
	it("names the Stable release that sorts just above the Preview build", () => {
		expect(awaitedStableVersion(waiting)).toBe("1.2.3");
		expect(awaitedStableVersion({ ...waiting, status: "checking" })).toBe("1.2.3");
	});

	it.each<[string, Partial<UpdaterState>]>([
		["updates are disabled", { enabled: false, status: "disabled" }],
		["the Preview track is still selected", { track: "preview" }],
		[
			"the installed build is already Stable",
			{ installedTrack: "stable", currentVersion: "1.2.2" },
		],
		["the Stable check failed", { status: "error", message: "Network error" }],
		["a Stable update is available", { status: "available", availableVersion: "1.2.3" }],
		["a Stable update is downloading", { status: "downloading" }],
		["a Stable update is downloaded", { status: "downloaded", downloadedVersion: "1.2.3" }],
		["the updater reports an available version", { availableVersion: "1.2.4" }],
		["the updater reports a downloaded version", { status: "idle", downloadedVersion: "1.2.4" }],
	])("is not waiting when %s", (_, change) => {
		expect(awaitedStableVersion({ ...waiting, ...change })).toBeNull();
	});
});
