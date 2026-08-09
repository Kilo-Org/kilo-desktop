import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

/**
 * Browser-mode registration for the anaconda-mcp feature.
 * The feature is main-process-only (no browser-mode fallback); this stub
 * satisfies the web features array without providing functionality.
 */
export function browserRegister(_sdk: SDK): void {
	// No-op: the anaconda-mcp feature is main-process-only.
	// The settings UI (#95) will add renderer-side wiring here.
}
