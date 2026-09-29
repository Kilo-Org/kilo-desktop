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
			tag: "v2.7.6-nightly.202609291557",
			version: "2.7.6-nightly.202609291557",
			channel: "nightly",
			commit: "d6959be66205165cb1d422d29fbf9b54a3b80d54",
			repository: "https://github.com/nteract/nteract.git",
		});
		expect(NTERACT_NOTEBOOK_UI).toEqual({
			assetName: "nteract-nightly-notebook-ui.tar.gz",
			bytes: 7_850_236,
			sha256: "2a6cb4354043b9ed8599c3fd48578ac92f372234cc133e08adb0072c37dab78b",
		});
	});

	it("pins the required runtimed daemon for every desktop release target", () => {
		expect(RUNTIMED_ARTIFACTS.map(({ target }) => target)).toEqual([
			"darwin-arm64",
			"darwin-x64",
			"linux-x64",
			"linux-arm64",
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
		expect(findRuntimedArtifact("win32", "arm64")).toBeUndefined();
		expect(() => getRuntimedArtifact("win32", "arm64")).toThrow(
			/runtimed is not configured for win32\/arm64/,
		);
	});
});
