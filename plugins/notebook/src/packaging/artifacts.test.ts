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
			tag: "v2.8.1-nightly.202610070906",
			version: "2.8.1-nightly.202610070906",
			channel: "nightly",
			commit: "217d6fe019133b96138678b4184bd4b62aafc3ab",
			repository: "https://github.com/nteract/nteract.git",
		});
		expect(NTERACT_NOTEBOOK_UI).toEqual({
			assetName: "nteract-nightly-notebook-ui.tar.gz",
			bytes: 7_854_898,
			sha256: "448cb82a89fb89618fc671c64fd2445d2a0821a59eb8134820545a21689eb066",
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
