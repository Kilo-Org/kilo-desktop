/**
 * Renderer entry for the Anaconda account plugin.
 *
 * `webRegister` exposes the `account` capability (session + sign-in/out) that
 * other plugins resolve with `sdk.plugins.get("anaconda-account")` — e.g. the
 * model catalog's "Sign in to Anaconda" prompt. `AnacondaAccountRow` is the
 * component the manifest contributes into kilo-ui's `account-panels` zone.
 */
import type { SDK } from "@kilo-desktop/feature-sdk";

import { createAnacondaAccountCapability } from "./anaconda-account-capability.js";

export { AnacondaAccountRow } from "./AnacondaAccountRow.js";

export function webRegister(sdk: SDK): void {
	sdk.plugins.expose("account", createAnacondaAccountCapability(sdk));
}
