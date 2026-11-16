import { KernelTelemetry, type PluginSdk } from "@kilo-desktop/kernel";

/** Sends one of the plugin's declared `kernel/telemetry-event`s; never fails the caller. */
export function track(sdk: PluginSdk, event: string, data: Record<string, unknown> = {}): void {
	try {
		void sdk.domainObjects
			.get(KernelTelemetry)
			?.methods.track({ event, data })
			.catch(() => undefined);
	} catch {
		// Tracking is best effort, including while the plugin deactivates.
	}
}
