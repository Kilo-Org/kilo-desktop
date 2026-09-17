import { describe, expect, it } from "vitest";

import {
	classifyReleaseDownload,
	extractReleaseNoteItems,
	getTrackReleaseName,
	getTrackReleaseTag,
	getTrackReleaseVersionFromTag,
	getGithubReleaseWrite,
	getGithubReleaseFlags,
	getLatestAliasKey,
	sanitizeGeneratedReleaseNotes,
} from "./track-release.js";

describe("track release publishing", () => {
	it("uses direct version tags and track-specific names", () => {
		expect(getTrackReleaseTag("preview", "1.2.3-preview-260826-12000")).toBe(
			"v1.2.3-preview-260826-12000",
		);
		expect(getTrackReleaseTag("stable", "1.2.3")).toBe("v1.2.3");
		expect(getTrackReleaseName("stable", "1.2.3")).toBe("Anaconda Agentic Desktop v1.2.3");
		expect(getTrackReleaseVersionFromTag("preview", "v1.2.3-preview-260826-12000")).toBe(
			"1.2.3-preview-260826-12000",
		);
		expect(getTrackReleaseVersionFromTag("stable", "v1.2.3-alpha.1")).toBe("1.2.3-alpha.1");
		expect(getTrackReleaseVersionFromTag("preview", "v1.2.3")).toBeNull();
		expect(getTrackReleaseVersionFromTag("stable", "v1.2.3-preview-260826-12000")).toBeNull();
	});

	it("creates releases on the first run and edits them on reruns", () => {
		expect(getGithubReleaseWrite(null)).toEqual({ endpoint: "/releases", method: "POST" });
		expect(getGithubReleaseWrite(2468)).toEqual({
			endpoint: "/releases/2468",
			method: "PATCH",
		});
	});

	it("marks only plain Stable versions as latest", () => {
		expect(getGithubReleaseFlags("stable", "1.2.3")).toEqual({
			prerelease: false,
			makeLatest: true,
		});
		expect(getGithubReleaseFlags("stable", "1.2.3-alpha.1")).toEqual({
			prerelease: true,
			makeLatest: false,
		});
		expect(getGithubReleaseFlags("preview", "1.2.3-preview-260826-12000")).toEqual({
			prerelease: true,
			makeLatest: false,
		});
	});

	it("removes linked and plain pull-request references without removing other numbers", () => {
		const markdown = [
			"## What's Changed",
			"* Improve Python 3.14 support by @ada in [#256](https://github.com/acme/app/pull/256)",
			"* Keep issue 42 visible (#300)",
			"* Faster startup by @grace in #301",
		].join("\n");
		const sanitized = sanitizeGeneratedReleaseNotes(markdown);

		expect(sanitized).toContain("Improve Python 3.14 support");
		expect(sanitized).toContain("Keep issue 42 visible");
		expect(sanitized).not.toMatch(/#(?:256|300|301)/);
		expect(extractReleaseNoteItems(sanitized)).toEqual([
			"Improve Python 3.14 support",
			"Keep issue 42 visible",
			"Faster startup",
		]);
	});

	it("excludes contributor and changelog boilerplate from app items", () => {
		const markdown = [
			"## Fixes",
			"* Fix updater",
			"## New Contributors",
			"* @ada made their first contribution",
			"**Full Changelog**: https://github.com/acme/app/compare/v1...v2",
		].join("\n");
		expect(extractReleaseNoteItems(markdown)).toEqual(["Fix updater"]);
	});

	it("classifies public downloads and derives latest aliases", () => {
		const download = classifyReleaseDownload(
			"/tmp/release/mac/out/make/dmg/darwin/arm64/Anaconda Agentic Desktop.dmg",
		);
		expect(download).toMatchObject({ platform: "macos", arch: "arm64", type: "dmg" });
		expect(getLatestAliasKey("preview", download!)).toBe(
			"anaconda-agentic-desktop/preview/latest/macos/arm64/Anaconda Agentic Desktop.dmg",
		);
		expect(
			getLatestAliasKey("preview", {
				...download!,
				platform: "windows",
				type: "setup",
			}),
		).toBe(
			"anaconda-agentic-desktop/preview/latest/windows/arm64/Anaconda-Agentic-Desktop-Setup.exe",
		);
		expect(getLatestAliasKey("stable", { ...download!, platform: "linux", type: "deb" })).toBe(
			"anaconda-agentic-desktop/latest/latest/linux/arm64/anaconda-agentic-desktop.deb",
		);
		expect(classifyReleaseDownload("/tmp/RELEASES.json")).toBeNull();
	});
});
