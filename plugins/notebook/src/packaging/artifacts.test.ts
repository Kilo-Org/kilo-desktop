import { describe, expect, it } from "vitest";

import {
	findNteractMcpArtifact,
	findRuntimedArtifact,
	getNteractMcpArtifact,
	getRuntimedArtifact,
	NTERACT_NOTEBOOK_UI,
	NTERACT_RELEASE,
	NTERACT_MCP_ARTIFACTS,
	RUNTIMED_ARTIFACTS,
	runtimedDownloadUrl,
} from "./artifacts.js";

describe("notebook distribution artifacts", () => {
	it("pins every bundled nteract component to the same nightly release", () => {
		expect(NTERACT_RELEASE).toEqual({
			tag: "v2.7.0-nightly.202608182247",
			version: "2.7.0-nightly.202608182247",
			channel: "nightly",
			commit: "de7a8ed1c658ca963d117a3abc046b4af9f12be0",
			repository: "https://github.com/nteract/nteract.git",
		});
		expect(NTERACT_NOTEBOOK_UI).toEqual({
			assetName: "nteract-nightly-notebook-ui.tar.gz",
			bytes: 7_816_621,
			sha256: "094f6a644b47542fa55e178ffdea96a3890cffb3ce286f84d16ff63d4a5c1d8b",
		});
	});

	it("pins nteract-mcp and a colocated runt child for every desktop target", () => {
		expect(NTERACT_MCP_ARTIFACTS.map(({ target }) => target)).toEqual([
			"darwin-arm64",
			"darwin-x64",
			"linux-x64",
			"win32-x64",
		]);
		for (const artifact of NTERACT_MCP_ARTIFACTS) {
			for (const binary of [artifact.nteractMcp, artifact.runt]) {
				expect(binary.sha256).toMatch(/^[a-f0-9]{64}$/);
				expect(binary.source.sha256).toMatch(/^[a-f0-9]{64}$/);
				expect(binary.bytes).toBeGreaterThan(1_000_000);
			}
		}
	});

	it("keeps every native asset on the pinned nightly channel", () => {
		expect(NTERACT_RELEASE.channel).toBe("nightly");
		for (const artifact of NTERACT_MCP_ARTIFACTS) {
			expect(artifact.nteractMcp.source.assetName).toContain("nightly");
			expect(artifact.runt.source.assetName).toContain("nightly");
			expect(artifact.runt.executable).toContain("nightly");
		}
		for (const artifact of RUNTIMED_ARTIFACTS) {
			expect(artifact.assetName).toContain("nightly");
			expect(artifact.executable).toContain("nightly");
		}
	});

	it("selects nteract-mcp by platform and rejects unsupported targets", () => {
		expect(getNteractMcpArtifact("win32", "x64").nteractMcp.executable).toBe("nteract-mcp.exe");
		expect(findNteractMcpArtifact("linux", "arm64")).toBeUndefined();
		expect(() => getNteractMcpArtifact("linux", "arm64")).toThrow(
			/nteract-mcp is not configured for linux\/arm64/,
		);
	});

	it("pins the required runtimed daemon for every desktop release target", () => {
		expect(RUNTIMED_ARTIFACTS.map(({ target }) => target)).toEqual([
			"darwin-arm64",
			"darwin-x64",
			"linux-x64",
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
		expect(findRuntimedArtifact("linux", "arm64")).toBeUndefined();
		expect(() => getRuntimedArtifact("linux", "arm64")).toThrow(
			/runtimed is not configured for linux\/arm64/,
		);
	});
});
