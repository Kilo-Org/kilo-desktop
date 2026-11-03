import { describe, expect, it } from "vitest";

import {
	classifyReleaseDownload,
	classifyReleaseNote,
	extractReleaseNoteItems,
	findPreviousTrackTag,
	groupGeneratedReleaseNotes,
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
		expect(getTrackReleaseName("stable", "1.2.3")).toBe("Kilo Desktop v1.2.3");
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

	it("removes pull-request references credited to bot authors", () => {
		const sanitized = sanitizeGeneratedReleaseNotes(
			"* chore(deps): update pnpm to v12.10.1 by @renovate[bot] in https://github.com/acme/app/pull/630",
		);
		expect(sanitized).toBe("* chore(deps): update pnpm to v12.10.1");
	});

	it("removes internal ticket ids from release-note items", () => {
		const markdown = [
			"## What's Changed",
			"* [ABC-3108]fix: transient directory EPERM - Windows",
			"* [ABC-3129] Keep the workspace file tree resilient",
			"* ABC-3122: serve agent tools from the main process",
			"* ABC-3129 fix(files): keep the tree resilient",
			"* [ABC-1] [ABC-2] feat: two tickets",
			"* fix: retry the send (ABC-42)",
			"* fix: retry the send [ABC-43]",
			"* fix: keep UTF-8 names and HTTP-2 support",
		].join("\n");
		expect(extractReleaseNoteItems(sanitizeGeneratedReleaseNotes(markdown))).toEqual([
			"fix: transient directory EPERM - Windows",
			"Keep the workspace file tree resilient",
			"serve agent tools from the main process",
			"fix(files): keep the tree resilient",
			"feat: two tickets",
			"fix: retry the send",
			"fix: retry the send",
			"fix: keep UTF-8 names and HTTP-2 support",
		]);
	});

	it("groups generated notes into Features, Fixes, Dependencies, then Other", () => {
		const markdown = [
			"## What's Changed",
			"* chore(codeowners): give QA ownership of e2e by @ada in https://github.com/acme/app/pull/1",
			"* fix(files): reopen the file pane by @ada in https://github.com/acme/app/pull/2",
			"* chore(deps): update pnpm to v12.10.1 by @renovate[bot] in https://github.com/acme/app/pull/3",
			"* feat(shell): reveal the app log by @grace in https://github.com/acme/app/pull/4",
			"* Forward bridge Sentry DSN by @grace in https://github.com/acme/app/pull/5",
			"* feat(kilo-ui): play sounds by @ada in https://github.com/acme/app/pull/6",
			"",
			"## New Contributors",
			"* @grace made their first contribution in https://github.com/acme/app/pull/4",
			"",
			"**Full Changelog**: https://github.com/acme/app/compare/v1...v2",
		].join("\n");

		expect(sanitizeGeneratedReleaseNotes(groupGeneratedReleaseNotes(markdown))).toBe(
			[
				"## What's Changed",
				"",
				"### Features",
				"* feat(shell): reveal the app log",
				"* feat(kilo-ui): play sounds",
				"",
				"### Fixes",
				"* fix(files): reopen the file pane",
				"",
				"### Dependencies",
				"* chore(deps): update pnpm to v12.10.1",
				"",
				"### Other",
				"* chore(codeowners): give QA ownership of e2e",
				"* Forward bridge Sentry DSN",
				"",
				"## New Contributors",
				"* @grace made their first contribution in https://github.com/acme/app/pull/4",
				"",
				"**Full Changelog**: https://github.com/acme/app/compare/v1...v2",
			].join("\n"),
		);
	});

	it("orders app items by section so features survive the item cap", () => {
		const grouped = groupGeneratedReleaseNotes(
			[
				"## What's Changed",
				"* test: cover handshake",
				"* fix: retry send",
				"* feat: pin chats",
			].join("\n"),
		);
		expect(extractReleaseNoteItems(grouped)).toEqual([
			"feat: pin chats",
			"fix: retry send",
			"test: cover handshake",
		]);
	});

	it("leaves notes without a What's Changed list untouched", () => {
		const markdown = "**Full Changelog**: https://github.com/acme/app/compare/v1...v2";
		expect(groupGeneratedReleaseNotes(markdown)).toBe(markdown);
	});

	it.each([
		["feat(marketplace): show the MCP command", "Features"],
		["feat!: drop legacy config", "Features"],
		["fix: transient EPERM", "Fixes"],
		["[ABC-3108]fix: transient directory EPERM - Windows", "Fixes"],
		["ABC-3129 fix(files): keep the tree resilient", "Fixes"],
		["chore(deps): update electron version", "Dependencies"],
		["fix(deps): update dependency koffi to v3.3.3", "Dependencies"],
		["chore(deps-dev): bump vitest", "Dependencies"],
		["fix(e2e): exclude .kilo worktrees from discovery", "Other"],
		["feat(ci): cache pnpm store", "Other"],
		["test(notebook): cover the port handshake", "Other"],
		["chore: bump desktop-bridge to 0.1.17", "Other"],
		["ABC-3122: serve agent tools from the main process", "Other"],
		["Enable conda bridge error reporting", "Other"],
	] as const)("classifies %j as %s", (title, section) => {
		expect(classifyReleaseNote(title)).toBe(section);
	});

	it("classifies dependency-bot pull requests as Dependencies regardless of title", () => {
		expect(
			classifyReleaseNote("update actions/upload-artifact action to v7", "renovate[bot]"),
		).toBe("Dependencies");
		expect(classifyReleaseNote("Bump koffi", "dependabot[bot]")).toBe("Dependencies");
	});

	it("finds the previous release on the same track, skipping newer and other-track tags", () => {
		const newestFirst = [
			"v0.1.13-preview-261015-21043",
			"v0.1.12",
			"v0.1.12-preview-261015-18064",
			"v0.1.11",
			"v0.1.10",
		];
		expect(findPreviousTrackTag(newestFirst, "stable", "v0.1.12")).toBe("v0.1.11");
		expect(findPreviousTrackTag(newestFirst, "stable", "v0.1.13")).toBe("v0.1.12");
		expect(findPreviousTrackTag(newestFirst, "preview", "v0.1.13-preview-261015-21043")).toBe(
			"v0.1.12-preview-261015-18064",
		);
		expect(findPreviousTrackTag(newestFirst, "stable", "v0.1.10")).toBeUndefined();
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
			"/tmp/release/mac/out/make/dmg/darwin/arm64/Kilo Preview.dmg",
		);
		expect(download).toMatchObject({ platform: "macos", arch: "arm64", type: "dmg" });
		expect(getLatestAliasKey("preview", download!)).toBe(
			"kilo-desktop/preview/latest/macos/arm64/Kilo Preview.dmg",
		);
		expect(
			getLatestAliasKey("preview", {
				...download!,
				platform: "windows",
				type: "setup",
			}),
		).toBe("kilo-desktop/preview/latest/windows/arm64/Kilo-Preview-Setup.exe");
		expect(getLatestAliasKey("stable", { ...download!, platform: "linux", type: "deb" })).toBe(
			"kilo-desktop/latest/latest/linux/arm64/kilo-desktop.deb",
		);
		expect(classifyReleaseDownload("/tmp/RELEASES.json")).toBeNull();
	});

	it("keeps Windows x64 and ARM64 setup installers on separate latest aliases", () => {
		const x64 = classifyReleaseDownload(
			"/tmp/release-artifacts/release-windows/squirrel.windows/x64/Kilo-Setup.exe",
		);
		const arm64 = classifyReleaseDownload(
			"/tmp/release-artifacts/release-windows-arm64/squirrel.windows/arm64/Kilo-Setup.exe",
		);
		expect(x64).toMatchObject({ platform: "windows", arch: "x64", type: "setup" });
		expect(arm64).toMatchObject({ platform: "windows", arch: "arm64", type: "setup" });
		expect(getLatestAliasKey("stable", x64!)).toBe(
			"kilo-desktop/latest/latest/windows/x64/Kilo-Setup.exe",
		);
		expect(getLatestAliasKey("stable", arm64!)).toBe(
			"kilo-desktop/latest/latest/windows/arm64/Kilo-Setup.exe",
		);
	});

	it("keeps x64 and arm64 Linux debs on separate latest aliases", () => {
		const x64 = classifyReleaseDownload(
			"/tmp/release-artifacts/release-linux/deb/x64/kilo-desktop_1.2.3_amd64.deb",
		);
		const arm64 = classifyReleaseDownload(
			"/tmp/release-artifacts/release-linux-arm64/deb/arm64/kilo-desktop_1.2.3_arm64.deb",
		);
		expect(x64).toMatchObject({ platform: "linux", arch: "x64", type: "deb" });
		expect(arm64).toMatchObject({ platform: "linux", arch: "arm64", type: "deb" });
		expect(getLatestAliasKey("stable", x64!)).toBe(
			"kilo-desktop/latest/latest/linux/x64/kilo-desktop.deb",
		);
		expect(getLatestAliasKey("stable", arm64!)).toBe(
			"kilo-desktop/latest/latest/linux/arm64/kilo-desktop.deb",
		);
	});
});
