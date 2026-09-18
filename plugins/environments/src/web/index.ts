/**
 * Renderer entry for the `environments` plugin.
 *
 * `EnvironmentsPage` is the page component named by the manifest route
 * (`plugin.json` `routes[].component`) — the shell resolves it here and
 * mounts it when `/environments` is visited. `EnvironmentsNavIcon` is the
 * sidebar icon.
 *
 * `webRegister` runs in both Electron and browser modes and dispatches to
 * each provider's tool-registration helper. Sub-issue 4 wires conda's
 * tools (`conda.envs.list`) — later slices add the mutating tools (create,
 * install, channels, jobs.cancel) without editing this file directly; the
 * per-provider `registerCondaTools` helper stays the extension point.
 *
 * Browser mode: tool calls that route through `sdk.invoke` require the
 * matching main-side handler to exist. This plugin's `mainRegister` is
 * Electron-only (talks to the bridge sidecar via JSON-RPC), so tools registered here
 * will reject in standalone browser mode — the same failure mode as the
 * todos plugin (Decision #7). The tools are still registered so that MCP
 * introspection sees a consistent surface across modes.
 */
import type { SDK } from "@kilo-desktop/feature-sdk";

import { registerCondaTools } from "../shared/providers/conda/tools.js";

export { EnvironmentsPage } from "./EnvironmentsPage.js";
export { EnvironmentsNavIcon } from "./EnvironmentsNavIcon.js";
export { EnvironmentsAuthProvider } from "./EnvironmentsAuthProvider.js";

export function webRegister(sdk: SDK): void {
	registerCondaTools(sdk);
}
