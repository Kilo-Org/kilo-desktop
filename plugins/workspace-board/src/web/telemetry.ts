import { KernelTelemetry, type PluginSdk } from "@kilo-desktop/kernel";

import type { BOARD_TELEMETRY_EVENTS } from "../contracts";

type BoardTelemetryEvent = (typeof BOARD_TELEMETRY_EVENTS)[keyof typeof BOARD_TELEMETRY_EVENTS];

let trackWith: ((event: string, data: Record<string, unknown>) => void) | undefined;

/** Sends board events through this window's kilo.workspace-board sdk; never fails the caller. */
export function startTelemetry(sdk: PluginSdk): void {
	trackWith = (event, data) =>
		void sdk.domainObjects
			.get(KernelTelemetry)
			?.methods.track({ event, data })
			.catch(() => undefined);
}

export function track(event: BoardTelemetryEvent, data: Record<string, unknown> = {}): void {
	trackWith?.(event, data);
}
