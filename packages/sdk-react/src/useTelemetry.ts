import { useFeatureSystem } from "./SdkProvider.js";

import type { SdkTelemetry } from "@kilo-desktop/feature-sdk";

/**
 * Track product telemetry from the renderer, backed by the shell telemetry
 * delegate. featureId tagging is NOT applied here — use
 * `useSdk(featureId).telemetry` for that.
 *
 * @example
 * const { track } = useTelemetry();
 * track({ event: "Page Visit", data: { path } });
 */
export function useTelemetry(): SdkTelemetry {
	return useFeatureSystem().services.shellDelegates.telemetry;
}
