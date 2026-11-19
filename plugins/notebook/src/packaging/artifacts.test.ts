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
	it("pins every bundled nteract component to one release, by tag, commit and checksum", () => {
		expect(NTERACT_RELEASE.tag).toBe(`v${NTERACT_RELEASE.version}`);
		expect(NTERACT_RELEASE.version).toContain(`-${NTERACT_RELEASE.channel}.`);
		expect(NTERACT_RELEASE.commit).toMatch(/^[a-f0-9]{40}$/);
		expect(NTERACT_NOTEBOOK_UI.assetName).toContain(`-${NTERACT_RELEASE.channel}-`);
		expect(NTERACT_NOTEBOOK_UI.sha256).toMatch(/^[a-f0-9]{64}$/);
		expect(NTERACT_NOTEBOOK_UI.bytes).toBeGreaterThan(0);
		for (const artifact of RUNTIMED_ARTIFACTS) {
			expect(artifact.assetName, artifact.target).toContain("runtimed-");
		}
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
