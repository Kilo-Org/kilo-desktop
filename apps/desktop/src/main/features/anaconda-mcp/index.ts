import { anacondaMcpContract } from "@anaconda-agentic-desktop/contracts";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

import { AnacondaMcpService, type AnacondaMcpServiceOptions } from "./AnacondaMcpService.js";
import { SettingsStore } from "./SettingsStore.js";

/** Default settings when no persisted config exists. */
const DEFAULT_SETTINGS: AnacondaMcpServiceOptions = {
	enabled: true,
	urlOverride: null,
};

/**
 * Main-side registration for the anaconda-mcp feature.
 *
 * Wires up the reconciliation state machine, subscribes to auth and
 * kilo-server events, and registers the contract channel handlers.
 * Settings are persisted to `<storageDir>/settings.json` so a user's
 * disable choice survives across restarts.
 */
export function mainRegister(mainSdk: MainSdk): void {
	// Async initialization: load persisted settings, then wire everything up.
	void (async () => {
		const settingsStore = await SettingsStore.load(
			mainSdk.storageDir,
			DEFAULT_SETTINGS,
			mainSdk.logger,
		);

		const service = new AnacondaMcpService({
			sdk: mainSdk,
			getSettings: () => settingsStore.get(),
			setSettings: (patch) => {
				void settingsStore.set(patch);
			},
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
			if (
				status !== null &&
				typeof status === "object" &&
				(status as { status?: unknown }).status === "ready"
			) {
				scheduleReconcile("kilo-ready");
			}
		});

		// Contract handlers.
		mainSdk.channels(anacondaMcpContract).handleAll({
			"status.get": async () => service.status,
			"settings.get": async () => settingsStore.get(),
			"settings.set": async (input) => {
				await settingsStore.set(input);
				scheduleReconcile("settings-change");
				return { ok: true as const };
			},
		});

		mainSdk.onDispose(() => {
			void service.dispose();
		});
	})().catch((error) => {
		mainSdk.logger.error(
			`anaconda-mcp: initialization failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
}
