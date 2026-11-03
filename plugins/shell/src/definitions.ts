import type { PluginDefinitions } from "@kilo-desktop/kernel";

import { SHELL_DOMAINS, SHELL_EXTENSION_POINTS } from "./contracts";

/** kilo.shell's extension points and domain objects, for the plugin list. */
export const SHELL_DEFINITIONS: PluginDefinitions = {
	extensionPoints: SHELL_EXTENSION_POINTS,
	domains: SHELL_DOMAINS,
};
