import { describe, expect, it } from "vitest";

import {
	findRuntimedArtifact,
	getRuntimedArtifact,
	NTERACT_NOTEBOOK_UI,
	NTERACT_RELEASE,
	RUNTIMED_ARTIFACTS,
	runtimedDownloadUrl,
} from "./artifacts.js";

describe("notebook distribution artifacts", () => {
	it("pins every bundled nteract component to the same nightly release", () => {
		expect(NTERACT_RELEASE).toEqual({
			tag: "v2.8.6-nightly.202610190909",
			version: "2.8.6-nightly.202610190909",
			channel: "nightly",
			commit: "488928b6765e7c5513fdbcd5e28f433f039fb05c",
			repository: "https://github.com/nteract/nteract.git",
		});
		expect(NTERACT_NOTEBOOK_UI).toEqual({
			assetName: "nteract-nightly-notebook-ui.tar.gz",
			bytes: 8_632_923,
			sha256: "289c9b70f9cf19d51a27353303594c4c7cd2c2f4a25b7387ded22fdca4198055",
		});
	});

	it("pins the required runtimed daemon for every desktop release target", () => {
		expect(RUNTIMED_ARTIFACTS.map(({ target }) => target)).toEqual([
			"darwin-arm64",
			"darwin-x64",
			"linux-x64",
			"linux-arm64",
			"win32-arm64",
			"win32-x64",
		]);
		for (const artifact of RUNTIMED_ARTIFACTS) {
			expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
			expect(artifact.bytes).toBeGreaterThan(30_000_000);
			expect(runtimedDownloadUrl(artifact)).toBe(
				`https://github.com/nteract/nteract/releases/download/${NTERACT_RELEASE.tag}/${artifact.assetName}`,
			);
		}
	});

	it("selects runtimed by platform and rejects unsupported targets", () => {
		expect(getRuntimedArtifact("win32", "x64").executable).toBe("runtimed-nightly.exe");
		expect(getRuntimedArtifact("linux", "arm64").assetName).toBe("runtimed-nightly-linux-arm64");
		expect(getRuntimedArtifact("win32", "arm64").assetName).toBe(
			"runtimed-nightly-windows-arm64.exe",
		);
		expect(findRuntimedArtifact("win32", "ia32")).toBeUndefined();
		expect(() => getRuntimedArtifact("win32", "ia32")).toThrow(
			/runtimed is not configured for win32\/ia32/,
		);
	});
});
