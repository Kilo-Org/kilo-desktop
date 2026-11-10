import { KernelTelemetry, type PluginSdk } from "@kilo-desktop/kernel";

import { Onboarding } from "../contracts";

/**
 * Origin's paths for the main window's routes, so "Page Visit" continues
 * origin's series: origin redirected "/" to its chat page `/plugins/chat`.
 * `/settings/<section>` kept its section ids.
 */
const ORIGIN_PATHS: Readonly<Record<string, string>> = { "/": "/plugins/chat" };

export function originPath(path: string): string {
	return ORIGIN_PATHS[path] ?? path;
}

export type TrackShellEvent = (event: string, data?: Record<string, unknown>) => void;

/** Sends one of kilo.shell's declared `kernel/telemetry-event`s; never fails the caller. */
export function shellTelemetry(sdk: PluginSdk): TrackShellEvent {
	return (event, data = {}) => {
		void sdk.domainObjects
			.get(KernelTelemetry)
			?.methods.track({ event, data })
			.catch(() => {});
	};
}

/** Reports onboarding being shown, completed or skipped, from its events. */
export function trackOnboarding(sdk: PluginSdk, track: TrackShellEvent): void {
	const onboarding = sdk.domainObjects.get(Onboarding);
	if (!onboarding) return;
	onboarding.on("shown", () => track("onboarding-shown"));
	onboarding.on("completed", () => track("onboarding-completed"));
	onboarding.on("skipped", () => track("onboarding-skipped"));
}
