import { describe, expect, it } from "vitest";

import {
	compareDaemonVersions,
	extractCommitHash,
	parseVersionOutput,
	readBundledDaemonVersion,
} from "./daemon-version.js";

describe("extractCommitHash", () => {
	it("reads the SHA that CI appends at build time", () => {
		expect(extractCommitHash("2.6.3+22d094c")).toBe("22d094c");
	});

	it("ignores a +dirty suffix, which marks an unclean tree rather than a different commit", () => {
		expect(extractCommitHash("2.6.3+22d094c+dirty")).toBe("22d094c");
	});

	it("returns undefined for a version with no SHA", () => {
		expect(extractCommitHash("2.6.3")).toBeUndefined();
	});
});

describe("parseVersionOutput", () => {
	it("drops the program name the daemon prints ahead of its version", () => {
		expect(parseVersionOutput("runtimed 2.6.3+22d094c\n")).toBe("2.6.3+22d094c");
	});

	it("returns undefined for empty output", () => {
		expect(parseVersionOutput("  \n")).toBeUndefined();
	});
});

describe("compareDaemonVersions", () => {
	it("matches two builds of the same commit", () => {
		expect(compareDaemonVersions("2.6.3+22d094c", "2.6.3+22d094c")).toBe("match");
	});

	it("matches across a dirty rebuild of the same commit, so local work is not blocked", () => {
		expect(compareDaemonVersions("2.6.3+22d094c+dirty", "2.6.3+22d094c")).toBe("match");
	});

	it("flags different commits even when the semver is identical", () => {
		// Typed-frame v4 fails closed, so equal X.Y.Z is not evidence of
		// compatibility — only the commit is.
		expect(compareDaemonVersions("2.6.3+aaaaaaa", "2.6.3+bbbbbbb")).toBe("mismatch");
	});

	it("is unknown when either side carries no commit hash", () => {
		expect(compareDaemonVersions("2.6.3", "2.6.3+22d094c")).toBe("unknown");
		expect(compareDaemonVersions("2.6.3+22d094c", "2.6.3")).toBe("unknown");
	});

	it("is unknown when either side is unavailable", () => {
		expect(compareDaemonVersions(undefined, "2.6.3+22d094c")).toBe("unknown");
		expect(compareDaemonVersions("2.6.3+22d094c", undefined)).toBe("unknown");
	});
});

describe("readBundledDaemonVersion", () => {
	it("reports undefined rather than throwing when the binary cannot be run", async () => {
		await expect(readBundledDaemonVersion("/nonexistent/runtimed")).resolves.toBeUndefined();
	});

	it("reads the version by running the binary", async () => {
		// `echo` stands in for the daemon: same contract, one line ending in the
		// version, so this exercises the real execFile path without a 38 MB fixture.
		await expect(readBundledDaemonVersion("/bin/echo")).resolves.toBe("--version");
	});
});
