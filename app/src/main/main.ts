import { Application } from "./Application.js";
import { registerDesktopSchemes } from "./platform/ElectronProtocol.js";

registerDesktopSchemes();

void new Application().start().catch((error: unknown) => {
	console.error("Anaconda Agentic Desktop failed to start.", error);
	process.exitCode = 1;
});
