import { describe, expect, it } from "vitest";

import {
	classifyReleaseDownload,
	extractReleaseNoteItems,
	getChannelReleaseName,
	getChannelReleaseTag,
	getChannelReleaseVersionFromTag,
	getGithubReleaseWrite,
	getLatestAliasKey,
	sanitizeGeneratedReleaseNotes,
} from "./channel-release.js";

describe("channel release publishing", () => {
	it("uses channel-qualified tags and names", () => {
		expect(getChannelReleaseTag("staging", "1.2.3")).toBe("desktop/staging/v1.2.3");
		expect(getChannelReleaseName("prod", "1.2.3")).toBe(
			"Anaconda Agentic Desktop Production v1.2.3",
		);
		expect(
			getChannelReleaseVersionFromTag("canary", "desktop/canary/v1.2.3-canary-260826-120000"),
		).toBe("1.2.3-canary-260826-120000");
		expect(getChannelReleaseVersionFromTag("canary", "desktop/prod/v1.2.3")).toBeNull();
	});

	it("creates releases on the first run and edits them on reruns", () => {
		expect(getGithubReleaseWrite(null)).toEqual({ endpoint: "/releases", method: "POST" });
		expect(getGithubReleaseWrite(2468)).toEqual({
			endpoint: "/releases/2468",
			method: "PATCH",
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
		expect(getLatestAliasKey("canary", download!)).toBe(
			"anaconda-agentic-desktop/canary/latest/macos/arm64/Anaconda Agentic Desktop Canary.dmg",
		);
		expect(
			getLatestAliasKey("staging", {
				...download!,
				platform: "windows",
				type: "setup",
			}),
		).toBe(
			"anaconda-agentic-desktop/staging/latest/windows/arm64/Anaconda-Agentic-Desktop-Staging-Setup.exe",
		);
		expect(getLatestAliasKey("prod", { ...download!, platform: "linux", type: "deb" })).toBe(
			"anaconda-agentic-desktop/prod/latest/linux/arm64/anaconda-agentic-desktop.deb",
		);
		expect(classifyReleaseDownload("/tmp/RELEASES.json")).toBeNull();
	});
});
