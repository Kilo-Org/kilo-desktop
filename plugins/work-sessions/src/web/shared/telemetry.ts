import { useMemo } from "react";

import { KernelTelemetry, type PluginSdk } from "@kilo-desktop/kernel";
import { useSdk } from "@kilo-desktop/kernel/web";

/**
 * kilo.work-sessions' window telemetry events (declared as
 * `kernel/telemetry-event` in plugin.json, with origin's names and payloads).
 * They are sent only from what a person does — toggling the arrangement,
 * choosing or saving a preset — never from layout syncs or the default
 * layout. Panes opened and closed are reported by main, from every
 * `kilo.work-sessions/panes` open and close.
 */
export type WorkSessionsEvent =
	| "layout-arrangement-changed"
	| "layout-preset-applied"
	| "layout-preset-saved"
	| "layout-preset-removed"
	| "layout-preset-default-changed"
	| "saved-page-opened"
	| "saved-item-opened"
	| "saved-item-removed"
	| "saved-page-searched"
	| "saved-page-filtered"
	| "saved-action-failed";

export type Track = (event: WorkSessionsEvent, data?: Record<string, unknown>) => void;

/** Sends events through `kernel/telemetry`; never fails the caller. */
export function trackerFor(sdk: PluginSdk): Track {
	return (event, data = {}) =>
		void sdk.domainObjects
			.get(KernelTelemetry)
			?.methods.track({ event, data })
			.catch(() => undefined);
}

/** {@link trackerFor} for a component. */
export function useTracker(): Track {
	const sdk = useSdk();
	return useMemo(() => trackerFor(sdk), [sdk]);
}
