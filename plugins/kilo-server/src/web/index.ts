import type { SDK } from "@kilo-desktop/feature-sdk";

import type { KiloServerService } from "../contracts/schemas.js";
import { createAgentToolSignInCapability } from "./agent-tool-sign-in.js";

export { kiloServerBrowserRegister as browserRegister } from "./browserRegister.js";
export { ExternalAiAppsNavIcon } from "./settings/ExternalAiAppsNavIcon.js";
export { ExternalAiAppsSettings } from "./settings/ExternalAiAppsSettings.js";

/** Renderer setup: lets chat read and change sign-in gating for agent tools. */
export function webRegister(sdk: SDK): void {
	sdk.plugins.expose("agentToolSignIn", {
		...createAgentToolSignInCapability(sdk as SDK<KiloServerService>),
	});
}
