import { describe, expect, it } from "vitest";

import { getAppIdentity, type AppEnvironment } from "./app-identity.js";

describe("app identity", () => {
	it.each([
		["development", "Dev", "dev"],
		["canary", "Canary", "canary"],
		["staging", "Staging", "staging"],
	] as const)("isolates the %s environment", (environment, displaySuffix, machineSuffix) => {
		expect(getAppIdentity(environment)).toEqual({
			appBundleId: `com.anaconda.agentic-desktop.${machineSuffix}`,
			environment,
			executableName: `anaconda-agentic-desktop-${machineSuffix}`,
			productName: `Anaconda Agentic Desktop ${displaySuffix}`,
			setupExecutableName: `Anaconda-Agentic-Desktop-${displaySuffix}-Setup.exe`,
			squirrelName: `AnacondaAgenticDesktop${displaySuffix}`,
			windowsAppUserModelId: `com.squirrel.AnacondaAgenticDesktop${displaySuffix}.anaconda-agentic-desktop-${machineSuffix}`,
		});
	});

	it("keeps the production identity unsuffixed", () => {
		expect(getAppIdentity("prod")).toEqual({
			appBundleId: "com.anaconda.agentic-desktop",
			environment: "prod",
			executableName: "anaconda-agentic-desktop",
			productName: "Anaconda Agentic Desktop",
			setupExecutableName: "Anaconda-Agentic-Desktop-Setup.exe",
			squirrelName: "AnacondaAgenticDesktop",
			windowsAppUserModelId: "com.squirrel.AnacondaAgenticDesktop.anaconda-agentic-desktop",
		});
	});

	it("covers every supported environment", () => {
		const environments = [
			"development",
			"canary",
			"staging",
			"prod",
		] satisfies readonly AppEnvironment[];

		expect(
			new Set(environments.map((environment) => getAppIdentity(environment).productName)).size,
		).toBe(environments.length);
	});
});
