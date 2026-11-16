import { describe, expect, it } from "vitest";

import {
	findRuntimedArtifact,
	getRuntimedArtifact,
	NTERACT_NOTEBOOK_UI,
	NTERACT_RELEASE,
	RUNTIMED_ARTIFACTS,
	runtimedDownloadUrl,
} from "./artifacts";

describe("notebook distribution artifacts", () => {
	it("pins every bundled nteract component to the same stable release", () => {
		expect(NTERACT_RELEASE).toEqual({
			tag: "v2.10.1-stable.202611161848",
			version: "2.10.1-stable.202611161848",
			channel: "stable",
			commit: "b275d446bbfdbfb8c36934e5b2a2ebe08acad82f",
			repository: "https://github.com/nteract/nteract.git",
		});
		expect(NTERACT_NOTEBOOK_UI).toEqual({
			assetName: "nteract-stable-notebook-ui.tar.gz",
			bytes: 11_370_612,
			sha256: "2b7c87a5cb9b6cf89c49f79d5fb5d25de053010d02f16e1ce89e7f5e5430a560",
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
		expect(getRuntimedArtifact("win32", "x64").executable).toBe("runtimed.exe");
		expect(getRuntimedArtifact("linux", "arm64").assetName).toBe("runtimed-linux-arm64");
		expect(getRuntimedArtifact("win32", "arm64").assetName).toBe("runtimed-windows-arm64.exe");
		expect(findRuntimedArtifact("win32", "ia32")).toBeUndefined();
		expect(() => getRuntimedArtifact("win32", "ia32")).toThrow(
			/runtimed is not configured for win32\/ia32/,
		);
	});
});
