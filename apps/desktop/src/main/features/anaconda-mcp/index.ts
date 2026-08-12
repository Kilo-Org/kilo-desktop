import { anacondaMcpContract } from "@anaconda-agentic-desktop/contracts";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";
import type { KiloServerStatus } from "@anaconda-agentic-desktop/plugin-kilo-server/contracts";

import { AnacondaMcpService } from "./AnacondaMcpService.js";
import { SettingsStore } from "./SettingsStore.js";

function isKiloReadyStatus(
	status: unknown,
): status is Extract<KiloServerStatus, { status: "ready" }> {
	return (status as KiloServerStatus | null | undefined)?.status === "ready";
}

/**
 * Main-side registration for the anaconda-mcp feature.
 *
 * Wires up the reconciliation state machine, subscribes to auth and
 * kilo-server events, and registers the contract channel handlers.
 * Settings are persisted to `<storageDir>/settings.json` so a user's
 * disable choice survives across restarts.
 */
export function mainRegister(mainSdk: MainSdk): void {
	const settingsStore = new SettingsStore(mainSdk);

	const service = new AnacondaMcpService({
		sdk: mainSdk,
		getSettings: () => settingsStore.get(),
	});

	const scheduleReconcile = (source: string): void => {
		void service.reconcile().catch((error) => {
			mainSdk.logger.warn(
				`anaconda-mcp: reconcile on ${source} failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		});
	};

	// Initial reconciliation.
	scheduleReconcile("boot");

	// React to auth changes (login/logout/key rotation).
	mainSdk.events.on("auth.changed", () => scheduleReconcile("auth-change"));

	// React to kilo-server becoming available/ready. Without this, if the
	// anaconda-mcp feature boots before kilo-server exposes its capability,
	// the state machine gets stuck at `waiting-for-kilo` until an unrelated
	// event fires. On every `ready` transition we retry reconciliation so
	// the MCP config is applied promptly after login+kilo boot.
	mainSdk.events.on("kilo-server.server-status-changed", (status: unknown) => {
		if (isKiloReadyStatus(status)) scheduleReconcile("kilo-ready");
	});

	// React to feature-flag toggles. The reconcile itself reads the current
	// value; this listener only needs to trigger a re-run when *any* flag
	// changes so a live toggle takes effect without a restart.
	mainSdk.events.on("feature-flag.changed", () => scheduleReconcile("feature-flag-change"));

	// Contract handlers.
	mainSdk.channels(anacondaMcpContract).handleAll({
		"status.get": async () => service.status,
		"settings.get": async () => settingsStore.get(),
		"settings.set": async (input) => {
			// Synchronous, atomic write — throws on failure so the renderer
			// learns the change was NOT saved instead of silently reverting
			// on the next restart.
			settingsStore.set(input);
			scheduleReconcile("settings-change");
			return { ok: true as const };
		},
	});

	mainSdk.onDispose(() => {
		// `onDispose` is a synchronous callback in the SDK; we can only
		// kick off the async teardown. Capture any rejection here so it
		// hits the logger instead of Node's unhandled-rejection warning
		// — the sdk logger's scope tags anaconda-mcp automatically.
		service.dispose().catch((error: unknown) => {
			mainSdk.logger.warn(
				`dispose failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		});
	});
}
