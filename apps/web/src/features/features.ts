import type { FeatureRegistration } from "@anaconda-agentic-desktop/feature-sdk";

/**
 * Feature registrations used when the app runs standalone in a browser
 * (no Electron main process). Mirrors the desktop FEATURES array in
 * apps/desktop/src/main/features/registry/features.ts — keep both in sync.
 *
 * Features whose mainRegister uses Node APIs (SQLite, fs, ...) must provide
 * browserRegister with browser-safe fakes to be usable in this mode.
 */
export const WEB_FEATURES: readonly FeatureRegistration[] = [
	// Features are added here as they are created or migrated.
	// Example:
	// { id: "todos", mainRegister: todosMainRegister, browserRegister: todosBrowserRegister },
];
