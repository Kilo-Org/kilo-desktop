import { useMemo } from "react";

import { KernelTelemetry, type PluginSdk } from "@kilo-desktop/kernel";
import { useSdk } from "@kilo-desktop/kernel/web";

import type { CHAT_TELEMETRY_EVENTS } from "../../contracts";

/** kilo.chat's telemetry events, declared as `kernel/telemetry-event` in plugin.json. */
export type ChatEvent = (typeof CHAT_TELEMETRY_EVENTS)[keyof typeof CHAT_TELEMETRY_EVENTS];

export type Track = (event: ChatEvent, data?: Record<string, unknown>) => void;

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
