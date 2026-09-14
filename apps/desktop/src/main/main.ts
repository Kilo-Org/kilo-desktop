import { Application } from "./Application.js";
import { PLUGIN_PROTOCOL_SCHEMES } from "./features/registry/bundled-plugin-manifests.js";
import { configureDevelopmentProfile } from "./platform/ElectronApp.js";
import { createLogger } from "./platform/logger.js";
import { registerDesktopSchemes } from "./platform/ElectronProtocol.js";
import { initSentry } from "./platform/sentry.js";
import electronSquirrelStartup from "electron-squirrel-startup";

if (electronSquirrelStartup) {
	process.exitCode = 0;
} else {
	configureDevelopmentProfile();
	initSentry();
	registerDesktopSchemes(PLUGIN_PROTOCOL_SCHEMES);

	void new Application().start().catch((error: unknown) => {
		createLogger("startup").error("Anaconda Agentic Desktop failed to start.", error);
		process.exitCode = 1;
	});
}
