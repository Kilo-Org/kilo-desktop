import { describe, expect, it } from "vitest";

import {
	findNteractMcpArtifact,
	findRuntimedArtifact,
	getNteractMcpArtifact,
	getRuntimedArtifact,
	NTERACT_NOTEBOOK_SOURCE,
	NTERACT_RELEASE,
	NTERACT_MCP_ARTIFACTS,
	RUNTIMED_ARTIFACTS,
	runtimedDownloadUrl,
} from "./artifacts.js";

describe("notebook distribution artifacts", () => {
	it("pins every bundled nteract component to the same stable release", () => {
		expect(NTERACT_RELEASE).toEqual({
			tag: "v2.7.0-stable.202608172336",
			commit: "f28fa6666cf4aab0e7dd1c6f5364a810107566b6",
			repository: "https://github.com/nteract/nteract.git",
		});
		expect(NTERACT_NOTEBOOK_SOURCE).toEqual({
			tag: NTERACT_RELEASE.tag,
			commit: "f28fa6666cf4aab0e7dd1c6f5364a810107566b6",
			repository: "https://github.com/nteract/nteract.git",
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
		expect(getRuntimedArtifact("win32", "x64").executable).toBe("runtimed.exe");
		expect(findRuntimedArtifact("linux", "arm64")).toBeUndefined();
		expect(() => getRuntimedArtifact("linux", "arm64")).toThrow(
			/runtimed is not configured for linux\/arm64/,
		);
	});
});
