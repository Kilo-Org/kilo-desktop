import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

/**
 * Mandatory feature registration array.
 * Every feature that will become a plugin registers here.
 * Adding a feature = adding an entry. Never edit Application.ts manually for feature-specific code.
 *
 * Each entry provides:
 * - id: unique feature identifier (becomes the plugin ID on migration)
 * - mainRegister(mainSdk): registers handlers, opens DB, etc.
 */
export const FEATURES: readonly FeatureRegistration[] = [
	// Features are added here as they are created or migrated.
	// Example:
	// { id: "todos", mainRegister: todosMainRegister },
];
