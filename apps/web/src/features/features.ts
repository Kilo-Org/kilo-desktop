import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

/**
 * Feature registrations used when the app runs standalone in a browser
 * (no Electron main process). Mirrors the desktop FEATURES array in
 * apps/desktop/src/main/features/registry/features.ts — keep both in sync.
 *
 * Only browserRegister boots in this mode; features without one are skipped
 * with a warning. Node-free features opt in with `browserRegister: register`;
 * features whose mainRegister uses Node APIs (SQLite, fs, ...) must provide
 * browser-safe fakes.
 */
export const WEB_FEATURES: readonly FeatureRegistration[] = [
	// Features are added here as they are created or migrated.
	// Example (Node-free feature, same register in both modes):
	// { id: "todos", mainRegister: register, browserRegister: register },
];
