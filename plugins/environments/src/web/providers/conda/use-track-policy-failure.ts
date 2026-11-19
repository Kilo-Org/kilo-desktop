import { useEffect, useRef } from "react";

import { ENVIRONMENTS_TELEMETRY_EVENTS } from "../../../contracts/index";
import { policyBlockedTelemetry } from "../../../shared/policy-telemetry";
import { useTrack } from "../../app";

/**
 * Reports a failure shown in Settings as `environment-policy-blocked`
 * (`surface: "ui"`) when it is a package-policy block, an Anaconda sign-in
 * refusal or a solve failure with a policy note; other failures send nothing.
 */
export function useTrackPolicyFailure(): (reason: unknown) => void {
	const track = useTrack();
	return (reason) => {
		const data = policyBlockedTelemetry(reason, "ui");
		if (data) track(ENVIRONMENTS_TELEMETRY_EVENTS.environmentPolicyBlocked, data);
	};
}

/**
 * Reports the failure a component shows ({@link useTrackPolicyFailure}) once,
 * when it mounts; a failure shown again (a new toast, the error state
 * reappearing) is reported again.
 */
export function useReportPolicyFailureOnce(reason: unknown): void {
	const trackPolicyFailure = useTrackPolicyFailure();
	const reported = useRef(false);
	useEffect(() => {
		if (reported.current) return;
		reported.current = true;
		trackPolicyFailure(reason);
	}, [reason, trackPolicyFailure]);
}
