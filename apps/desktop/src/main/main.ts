import { Application } from "./Application.js";
import { PLUGIN_PROTOCOL_SCHEMES } from "./features/registry/bundled-plugin-manifests.js";
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
import electronSquirrelStartup from "electron-squirrel-startup";

if (electronSquirrelStartup) {
	process.exitCode = 0;
} else {
	configureAppProfile();
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
