import { app } from "electron";

import { BUNDLED_PLUGINS, protocolSchemes } from "@kilo-desktop/bundled-plugins";

import { KernelApplication } from "./kernel/KernelApplication.js";
import { hasForbiddenDebugArgs } from "./platform/debug-args.js";
import { configureAppProfile } from "./platform/ElectronApp.js";
import {
	configureLogging,
	createLogger,
	LOG_LEVEL_ENV_VAR,
	resolveLogLevel,
} from "./platform/logger.js";
import { PreferencesStore } from "./platform/PreferencesStore.js";
import { registerDesktopSchemes } from "./platform/ElectronProtocol.js";
import { initSentry } from "./platform/sentry.js";
import { brandSquirrelUninstallEntry } from "./platform/SquirrelUninstallIcon.js";
import electronSquirrelStartup from "electron-squirrel-startup";
import { getAppIdentity } from "$config/app-identity.js";

if (electronSquirrelStartup) {
	brandSquirrelUninstallEntry({
		argv: process.argv,
		execPath: process.execPath,
		resourcesPath: process.resourcesPath,
		squirrelName: getAppIdentity(RELEASE_TRACK).squirrelName,
	});
	process.exitCode = 0;
} else if (shouldRefuseDebugLaunch()) {
	createLogger("startup").warn(
		"Refusing to start: debugging launch arguments are not allowed in packaged builds.",
	);
	app.exit(1);
} else {
	const { formerRoots } = configureAppProfile();

	// E2E runs must never reach PostHog, Sentry, or subprocess telemetry.
	const preferences = new PreferencesStore(undefined, { forceDataCollectionOff: isE2eBuild() });
	configureLogging(
		resolveLogLevel({
			env: process.env[LOG_LEVEL_ENV_VAR],
			stored: preferences.getLogLevel(),
		}),
	);
	initSentry(preferences);
	registerDesktopSchemes(protocolSchemes(BUNDLED_PLUGINS));

	void new KernelApplication(preferences, formerRoots).start().catch((error: unknown) => {
		createLogger("startup").error("Kilo Desktop failed to start.", error);
		process.exitCode = 1;
	});
}

/** `package:e2e` bakes `VITE_KILO_E2E_AUTH=1` into binaries built for Playwright. */
function isE2eBuild(): boolean {
	return import.meta.env.VITE_KILO_E2E_AUTH === "1";
}

// E2E builds launch with inspector flags on purpose.
function shouldRefuseDebugLaunch(): boolean {
	if (!app.isPackaged) return false;
	if (isE2eBuild()) return false;
	return hasForbiddenDebugArgs(process.argv, (name) => app.commandLine.hasSwitch(name));
}
