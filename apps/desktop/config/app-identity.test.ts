import { describe, expect, it } from "vitest";

import {
	getAppCopyright,
	getAppIdentity,
	getDmgVolumeTitle,
	getVersionedSetupExecutableName,
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

	it.each(["preview", "stable"] as const)("installs %s as the one Kilo app", (environment) => {
		expect(getAppIdentity(environment)).toEqual({
			appBundleId: "ai.kilo.desktop",
			environment,
			executableName: "kilo-desktop",
			productName: "Kilo",
			setupExecutableName: "Kilo-Setup.exe",
			squirrelName: "KiloDesktop",
			userDataName: "Kilo Desktop",
			windowsAppUserModelId: "com.squirrel.KiloDesktop.kilo-desktop",
		});
	});

	it.each([
		["stable", "1.2.3", "x64", "Kilo-1.2.3-x64-Setup.exe"],
		[
			"preview",
			"1.2.3-preview-260101-12345",
			"arm64",
			"Kilo-1.2.3-preview-260101-12345-arm64-Setup.exe",
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

describe("app copyright", () => {
	it("credits Anaconda, Inc. from the year the codebase started", () => {
		expect(getAppCopyright(new Date("2026-11-04T12:00:00Z"))).toBe(
			"Copyright © 2026 Anaconda, Inc.",
		);
	});

	it("extends the year range as the build date advances", () => {
		expect(getAppCopyright(new Date("2028-02-01T00:00:00Z"))).toBe(
			"Copyright © 2026–2028 Anaconda, Inc.",
		);
	});
});
