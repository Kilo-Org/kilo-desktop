import { describe, expect, it } from "vitest";

import { getKiloCliArtifact, KILO_CLI_VERSION } from "./artifacts.js";

describe("Kilo CLI artifacts", () => {
	it("pins the supported native targets and compatibility-first x64 variants", () => {
		expect(KILO_CLI_VERSION).toBe("7.4.20");
		expect(getKiloCliArtifact("darwin", "arm64")).toMatchObject({
			target: "darwin-arm64",
			packageName: "@kilocode/cli-darwin-arm64",
		});
		expect(getKiloCliArtifact("win32", "x64").target).toBe("windows-x64-baseline");
		expect(getKiloCliArtifact("linux", "x64").target).toBe("linux-x64-baseline");
	});

	it("rejects targets the release pipeline does not build", () => {
		expect(() => getKiloCliArtifact("darwin", "x64")).toThrow(
			"Kilo CLI is not configured for darwin/x64.",
		);
	});
});
