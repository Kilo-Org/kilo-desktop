import { anacondaMcpContract } from "@anaconda-agentic-desktop/contracts";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

import { AnacondaMcpService, type AnacondaMcpServiceOptions } from "./AnacondaMcpService.js";

/** Default settings when no persisted config exists. */
const DEFAULT_SETTINGS: AnacondaMcpServiceOptions = {
	enabled: true,
	urlOverride: null,
};

/**
 * Main-side registration for the anaconda-mcp feature.
 *
 * Wires up the reconciliation state machine, subscribes to auth changes,
 * and registers the contract channel handlers.
 */
export function mainRegister(mainSdk: MainSdk): void {
	// ─── Settings (in-memory for v1; persisted store is a follow-up) ─────────
	let settings: AnacondaMcpServiceOptions = { ...DEFAULT_SETTINGS };

	// ─── Service ────────────────────────────────────────────────────────────────
	const service = new AnacondaMcpService({
		sdk: mainSdk,
		getSettings: () => settings,
		setSettings: (patch) => {
			settings = { ...settings, ...patch };
		},
	});

	// ─── Initial reconciliation ─────────────────────────────────────────────────
	// Kick off the first reconcile. It will end up in waiting-for-auth or
	// waiting-for-kilo if dependencies aren't ready yet.
	void service.reconcile().catch((error) => {
		mainSdk.logger.warn(
			`anaconda-mcp: initial reconcile failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	});

	// ─── React to auth changes ──────────────────────────────────────────────────
	mainSdk.events.on("auth.changed", () => {
		void service.reconcile().catch((error) => {
			mainSdk.logger.warn(
				`anaconda-mcp: reconcile on auth change failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	});

	// ─── Contract handlers ──────────────────────────────────────────────────────
	mainSdk.channels(anacondaMcpContract).handleAll({
		"status.get": async () => service.status,
		"settings.get": async () => settings,
		"settings.set": async (input) => {
			if (input.enabled !== undefined) settings.enabled = input.enabled;
			if (input.urlOverride !== undefined) settings.urlOverride = input.urlOverride;
			void service.reconcile().catch((error) => {
				mainSdk.logger.warn(
					`anaconda-mcp: reconcile on settings change failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			});
			return { ok: true as const };
		},
	});

	// ─── Teardown ───────────────────────────────────────────────────────────────
	mainSdk.onDispose(() => {
		void service.dispose();
	});
}
