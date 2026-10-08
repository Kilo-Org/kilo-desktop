import { app } from "electron";

import { Application } from "./Application.js";
import { PLUGIN_PROTOCOL_SCHEMES } from "./features/registry/bundled-plugin-manifests.js";
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
	configureAppProfile();

	// The anaconda-desktop-bridge sidecar reads its Sentry DSN from the
	// BRIDGE_SENTRY_DSN env var. The value is a build-time constant per release
	// track (empty for dev/preview); publish it into process.env so the bridge
	// inherits it when SidecarCondaBackend spawns the child. Consent gating is
	// handled separately by BRIDGE_TELEMETRY_ENABLED.
	const bridgeSentryDsn = import.meta.env.VITE_BRIDGE_SENTRY_DSN;
	if (bridgeSentryDsn) process.env.BRIDGE_SENTRY_DSN = bridgeSentryDsn;

	const preferences = new PreferencesStore();
	configureLogging(
		resolveLogLevel({
			env: process.env[LOG_LEVEL_ENV_VAR],
			stored: preferences.getLogLevel(),
		}),
	);
	initSentry(preferences);
	registerDesktopSchemes(PLUGIN_PROTOCOL_SCHEMES);

	void new Application(preferences).start().catch((error: unknown) => {
		createLogger("startup").error("Kilo Desktop failed to start.", error);
		process.exitCode = 1;
	});
}

// E2E builds bake VITE_KILO_E2E_AUTH and launch with inspector flags on purpose.
function shouldRefuseDebugLaunch(): boolean {
	if (!app.isPackaged) return false;
	if (import.meta.env.VITE_KILO_E2E_AUTH === "1") return false;
	return hasForbiddenDebugArgs(process.argv, (name) => app.commandLine.hasSwitch(name));
}
