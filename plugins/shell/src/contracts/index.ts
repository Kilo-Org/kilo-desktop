import type { PluginDefinitions } from "@kilo-desktop/kernel";

import { SHELL_DOMAIN_OBJECTS } from "./domain-objects";
import { SHELL_EXTENSION_POINTS } from "./extension-points";

export * from "./domain-objects";
export * from "./extension-points";

/**
 * kilo.shell's public surface: the window's extension points and the domain
 * objects other plugins use (appearance, theme, navigation, notifications,
 * onboarding, legal). It draws everything the user sees of kilo.core.
 */
export const SHELL_PLUGIN_ID = "kilo.shell";

/** The flag that lets people switch between the stable and preview update tracks. */
export const UPDATE_TRACK_SWITCHER_FLAG = "update-track-switcher";

/** The flag that shows the app's Beta badges (header, About, onboarding wordmark). */
export const BETA_BADGES_FLAG = "beta-badges";

export const SHELL_DEFINITIONS: PluginDefinitions = {
	extensionPoints: SHELL_EXTENSION_POINTS,
	domainObjects: SHELL_DOMAIN_OBJECTS,
};
