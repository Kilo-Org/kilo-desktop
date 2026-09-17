import { describe, expect, it } from "vitest";

import { getAppIdentity, type AppEnvironment } from "./app-identity.js";

describe("app identity", () => {
	it("isolates the development environment", () => {
		expect(getAppIdentity("development")).toEqual({
			appBundleId: "com.anaconda.agentic-desktop.dev",
			environment: "development",
			executableName: "anaconda-agentic-desktop-dev",
			productName: "Anaconda Agentic Desktop Dev",
			setupExecutableName: "Anaconda-Agentic-Desktop-Dev-Setup.exe",
			squirrelName: "AnacondaAgenticDesktopDev",
			windowsAppUserModelId: "com.squirrel.AnacondaAgenticDesktopDev.anaconda-agentic-desktop-dev",
		});
	});

	it.each(["preview", "stable"] as const)("shares the packaged identity for %s", (environment) => {
		expect(getAppIdentity(environment)).toEqual({
			appBundleId: "com.anaconda.agentic-desktop",
			environment,
			executableName: "anaconda-agentic-desktop",
			productName: "Anaconda Agentic Desktop",
			setupExecutableName: "Anaconda-Agentic-Desktop-Setup.exe",
			squirrelName: "AnacondaAgenticDesktop",
			windowsAppUserModelId: "com.squirrel.AnacondaAgenticDesktop.anaconda-agentic-desktop",
		});
	});

	it("covers every supported environment", () => {
		const environments = ["development", "preview", "stable"] satisfies readonly AppEnvironment[];

		expect(
			new Set(environments.map((environment) => getAppIdentity(environment).productName)),
		).toEqual(new Set(["Anaconda Agentic Desktop Dev", "Anaconda Agentic Desktop"]));
	});
});
