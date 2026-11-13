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
	it("pins every bundled nteract component to the same stable release", () => {
		expect(NTERACT_RELEASE).toEqual({
			tag: "v2.10.0-stable.202611130133",
			version: "2.10.0-stable.202611130133",
			channel: "stable",
			commit: "211f11c4169910b13ac5da676a9da6718791a77a",
			repository: "https://github.com/nteract/nteract.git",
		});
		expect(NTERACT_NOTEBOOK_UI).toEqual({
			assetName: "nteract-stable-notebook-ui.tar.gz",
			bytes: 11_358_418,
			sha256: "eb00998377506e411da008e2368afe24f234ab1c976cba36b4607826f7c8dd90",
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
