import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

import { mainRegister as sdkConsumerMainRegister } from "../sdk-consumer/index.js";
import { mainRegister as sdkExplorerMainRegister } from "../sdk-producer/index.js";

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
	{ id: "sdk-producer", mainRegister: sdkExplorerMainRegister },
	{ id: "sdk-consumer", mainRegister: sdkConsumerMainRegister },
];
