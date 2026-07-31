import { Application } from "./Application.js";
import { createLogger } from "./platform/logger.js";
import { registerDesktopSchemes } from "./platform/ElectronProtocol.js";
import electronSquirrelStartup from "electron-squirrel-startup";

if (electronSquirrelStartup) {
	process.exitCode = 0;
} else {
	registerDesktopSchemes();

	void new Application().start().catch((error: unknown) => {
		createLogger("startup").error("Anaconda Agentic Desktop failed to start.", error);
		process.exitCode = 1;
	});
}
