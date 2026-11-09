import type { PluginSdk } from "@kilo-desktop/kernel";
import { Telemetry } from "@kilo-desktop/plugin-telemetry/contracts";

/** The board's declared telemetry events (kilo.telemetry/telemetry-event names). */
export const BOARD_EVENTS = {
	opened: "Workspace Board Opened",
	placed: "Workspace Board Session Placed",
	columnAdded: "Workspace Board Column Added",
	cleared: "Workspace Board Cleared",
} as const;

let trackWith: ((event: string, data: Record<string, unknown>) => void) | undefined;

/** Sends board events through this window's kilo.workspace-board sdk; never fails the caller. */
export function startTelemetry(sdk: PluginSdk): void {
	trackWith = (event, data) =>
		void sdk.domains
			.get(Telemetry)
			?.methods.track({ event, data })
			.catch(() => undefined);
}

export function track(
	event: (typeof BOARD_EVENTS)[keyof typeof BOARD_EVENTS],
	data: Record<string, unknown> = {},
): void {
	trackWith?.(event, data);
}
