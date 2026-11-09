import { describe, expect, it } from "vitest";

import {
	getAppIdentity,
	getDmgVolumeTitle,
	getVersionedSetupExecutableName,
	type AppEnvironment,
} from "./app-identity.js";

describe("app identity", () => {
	it("isolates the development environment", () => {
		expect(getAppIdentity("development")).toEqual({
			appBundleId: "ai.kilo.desktop.dev",
			environment: "development",
			executableName: "kilo-desktop-dev",
			productName: "Kilo Dev",
			setupExecutableName: "Kilo-Dev-Setup.exe",
			squirrelName: "KiloDesktopDev",
			userDataName: "Kilo Desktop Dev",
			windowsAppUserModelId: "com.squirrel.KiloDesktopDev.kilo-desktop-dev",
		});
	});

	it.each([
		["preview", "Kilo Preview", "Kilo-Preview-Setup.exe", "Kilo Desktop Preview"],
		["stable", "Kilo", "Kilo-Setup.exe", "Kilo Desktop"],
	] as const)(
		"uses the %s product identity",
		(environment, productName, setupExecutableName, userDataName) => {
			expect(getAppIdentity(environment)).toEqual({
				appBundleId: "ai.kilo.desktop",
				environment,
				executableName: "kilo-desktop",
				productName,
				setupExecutableName,
				squirrelName: "KiloDesktop",
				userDataName,
				windowsAppUserModelId: "com.squirrel.KiloDesktop.kilo-desktop",
			});
		},
	);

	it("covers every supported environment", () => {
		const environments = ["development", "preview", "stable"] satisfies readonly AppEnvironment[];

		expect(
			new Set(environments.map((environment) => getAppIdentity(environment).productName)),
		).toEqual(new Set(["Kilo Dev", "Kilo Preview", "Kilo"]));
	});

	it.each([
		["stable", "1.2.3", "x64", "Kilo-1.2.3-x64-Setup.exe"],
		[
			"preview",
			"1.2.3-preview-260101-12345",
			"arm64",
			"Kilo-Preview-1.2.3-preview-260101-12345-arm64-Setup.exe",
		],
		["development", "0.0.0", "x64", "Kilo-Dev-0.0.0-x64-Setup.exe"],
	] as const)(
		"versions the %s Windows installer file name",
		(environment, version, arch, expected) => {
			expect(getVersionedSetupExecutableName(getAppIdentity(environment), version, arch)).toBe(
				expected,
			);
		},
	);

	it("uses track-specific DMG volume titles", () => {
		expect(getDmgVolumeTitle("preview")).toBe("Kilo Preview");
		expect(getDmgVolumeTitle("stable")).toBe("Kilo");
	});
});
