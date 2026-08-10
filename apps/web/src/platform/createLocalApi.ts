import type { LocalApi } from "@anaconda-agentic-desktop/contracts";

import { createBrowserLocalApi } from "./browserLocalApi";
import { createElectronLocalApi } from "./electronLocalApi";

/**
 * Prefer the Electron preload bridge when present; otherwise use the browser adapter.
 * Matches the t3code host-detection pattern (bridge presence, not protocol sniffing).
 */
export function createLocalApi(): LocalApi {
	const bridge = globalThis.window?.desktopApi;
	return bridge ? createElectronLocalApi(bridge) : createBrowserLocalApi();
}
