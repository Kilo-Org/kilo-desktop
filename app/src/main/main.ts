import { Application } from "./Application.js";
import { registerDesktopSchemes } from "./platform/ElectronProtocol.js";
import electronSquirrelStartup from "electron-squirrel-startup";

if (electronSquirrelStartup) {
	process.exitCode = 0;
} else {
	registerDesktopSchemes();

	void new Application().start().catch((error: unknown) => {
		console.error("Anaconda Agentic Desktop failed to start.", error);
		process.exitCode = 1;
	});
}
