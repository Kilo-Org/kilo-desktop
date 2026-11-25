import { describe, expect, it } from "vitest";

import packageJson from "../../../../package.json" with { type: "json" };

import { getKiloCliArtifact, KILO_CLI_ARTIFACTS } from "./artifacts.js";

describe("Kilo CLI distribution artifacts", () => {
	it("pins the supported native targets and compatibility-first x64 variants", () => {
		expect(getKiloCliArtifact("darwin", "arm64")).toMatchObject({
			target: "darwin-arm64",
			packageName: "@kilocode/cli-darwin-arm64",
			executable: "kilo2",
		});
		expect(getKiloCliArtifact("win32", "x64")).toMatchObject({
			target: "windows-x64-baseline",
			executable: "kilo2.exe",
		});
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

	it("installs every target's package as an optional dependency of kilo.core", () => {
		expect(Object.keys(packageJson.optionalDependencies).toSorted()).toEqual(
			KILO_CLI_ARTIFACTS.map((artifact) => artifact.packageName).toSorted(),
		);
	});

	it("rejects targets the release pipeline does not build", () => {
		expect(() => getKiloCliArtifact("darwin", "x64")).toThrow(
			"Kilo CLI is not configured for darwin/x64.",
		);
	});
});
