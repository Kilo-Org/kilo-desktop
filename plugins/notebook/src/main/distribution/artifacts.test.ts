import { describe, expect, it } from "vitest";

import {
	getRuntimedArtifact,
	NTERACT_RELEASE,
	RUNTIMED_ARTIFACTS,
	runtimedDownloadUrl,
} from "./artifacts.js";

describe("notebook distribution artifacts", () => {
	it("pins one daemon for every supported desktop target", () => {
		expect(RUNTIMED_ARTIFACTS.map(({ target }) => target)).toEqual([
			"darwin-arm64",
			"darwin-x64",
			"linux-x64",
			"win32-x64",
		]);
		for (const artifact of RUNTIMED_ARTIFACTS) {
			expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
			expect(artifact.bytes).toBeGreaterThan(1_000_000);
			expect(runtimedDownloadUrl(artifact)).toBe(
				`https://github.com/nteract/nteract/releases/download/${NTERACT_RELEASE.tag}/${artifact.assetName}`,
			);
		}
	});

	it("selects the artifact by platform and architecture", () => {
		expect(getRuntimedArtifact("darwin", "arm64").assetName).toContain("darwin-arm64");
		expect(getRuntimedArtifact("win32", "x64").executable).toBe("runtimed-nightly.exe");
	});

	it("rejects unsupported targets", () => {
		expect(() => getRuntimedArtifact("linux", "arm64")).toThrow(
			/runtimed is not configured for linux\/arm64/,
		);
	});
});
