import { describe, expect, it } from "vitest";

import {
	findRuntArtifact,
	getRuntArtifact,
	NTERACT_RELEASE,
	RUNT_ARTIFACTS,
	runtDownloadUrl,
} from "./artifacts.js";

describe("notebook distribution artifacts", () => {
	it("pins runt mcp CLIs for platforms that publish them", () => {
		expect(RUNT_ARTIFACTS.map(({ target }) => target)).toEqual([
			"darwin-arm64",
			"darwin-x64",
			"linux-x64",
		]);
		for (const artifact of RUNT_ARTIFACTS) {
			expect(artifact.sha256).toMatch(/^[a-f0-9]{64}$/);
			expect(artifact.bytes).toBeGreaterThan(1_000_000);
			expect(runtDownloadUrl(artifact)).toBe(
				`https://github.com/nteract/nteract/releases/download/${NTERACT_RELEASE.tag}/${artifact.assetName}`,
			);
		}
	});

	it("selects the artifact by platform and architecture", () => {
		expect(getRuntArtifact("darwin", "arm64").executable).toBe("runt-nightly");
		expect(findRuntArtifact("win32", "x64")).toBeUndefined();
	});

	it("rejects unsupported targets", () => {
		expect(() => getRuntArtifact("win32", "x64")).toThrow(/runt is not configured for win32\/x64/);
	});
});
