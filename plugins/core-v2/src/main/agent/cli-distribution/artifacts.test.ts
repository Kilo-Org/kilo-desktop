import { describe, expect, it } from "vitest";

import packageJson from "../../../../package.json" with { type: "json" };

import { getKiloCliArtifact, KILO_CLI_VERSION } from "./artifacts.js";

describe("Kilo CLI distribution artifacts", () => {
	it("pins the supported native targets and compatibility-first x64 variants", () => {
		expect(KILO_CLI_VERSION).toMatch(/^0\.0\.0-v2-\d+$/);
		expect(new Set(Object.values(packageJson.optionalDependencies))).toEqual(
			new Set([KILO_CLI_VERSION]),
		);
		expect(getKiloCliArtifact("darwin", "arm64")).toMatchObject({
			target: "darwin-arm64",
			packageName: "@kilocode/cli-darwin-arm64",
		});
		expect(getKiloCliArtifact("win32", "x64").target).toBe("windows-x64-baseline");
		expect(getKiloCliArtifact("win32", "arm64")).toMatchObject({
			target: "windows-arm64",
			packageName: "@kilocode/cli-windows-arm64",
		});
		expect(getKiloCliArtifact("linux", "x64").target).toBe("linux-x64-baseline");
		expect(getKiloCliArtifact("linux", "arm64")).toMatchObject({
			target: "linux-arm64",
			packageName: "@kilocode/cli-linux-arm64",
		});
	});

	it("rejects targets the release pipeline does not build", () => {
		expect(() => getKiloCliArtifact("darwin", "x64")).toThrow(
			"Kilo CLI is not configured for darwin/x64.",
		);
	});
});
