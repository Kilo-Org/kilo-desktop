import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

export { AnacondaMcpSettings } from "./AnacondaMcpSettings.js";

/**
 * Browser-mode registration for the anaconda-mcp feature.
 *
 * In browser mode (no Electron main process) the feature cannot reconcile
 * auth or manage the Kilo server, so it remains a no-op aside from
 * providing the exported settings component for the renderer route.
 */
export function browserRegister(_mainSdk: MainSdk): void {
	// The settings component handles its own event subscriptions via hooks.
	// No global browser-mode setup is needed.
}
