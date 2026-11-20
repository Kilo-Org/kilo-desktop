import {
	KernelApp,
	KernelService,
	KernelTelemetry,
	KernelTelemetrySink,
	type PluginSdk,
	type TelemetryEnvelope,
} from "@kilo-desktop/kernel";

import type { TelemetryEntry, TelemetryProvider } from "./types";
import { calculatePeriodId } from "./utils";

export type { TelemetryProvider } from "./types";

export interface TelemetryOptions {
	readonly createProvider: (config: { readonly appVersion: string }) => TelemetryProvider;
	/** Identifies this run of the app in every event; random by default. */
	readonly appRunId?: string;
}

/**
 * The telemetry area: PostHog as a `kernel/telemetry-sink` (`posthog`). The
 * kernel already applied consent and declaration and built the envelope;
 * this area adds what PostHog reports with every event (installation and
 * run ids, the signed-in email and cohort, whether this is an Anaconda
 * employee, environment and app version). The PostHog daemon reports
 * "Desktop Initialized" once the window is shown and flushes queued events
 * on quit.
 */
export function activateTelemetry(sdk: PluginSdk, options: TelemetryOptions): void {
	const appRunId = options.appRunId ?? crypto.randomUUID();
	const appVersion = sdk.domainObjects.get(KernelApp)?.getState().version ?? "0.0.0";
	const provider = options.createProvider({ appVersion });

	sdk.extensions.implement(KernelTelemetrySink, "posthog", {
		deliver: (envelope) => provider.track(entryFor(envelope, appRunId)),
	});

	sdk.extensions.implement(KernelService, "posthog", {
		start: () => {
			void sdk.domainObjects
				.get(KernelTelemetry)
				?.methods.track({
					event: "desktop-initialized",
					data: { timestamp: Date.now(), version: appVersion, platform: process.platform },
				})
				.catch(() => undefined);
		},
		stop: () => provider.dispose(),
	});
}

function entryFor(envelope: TelemetryEnvelope, appRunId: string): TelemetryEntry {
	const primary = envelope.identity.primary;
	const email = primary?.email;
	return {
		event: envelope.name,
		data: { ...envelope.data },
		installationId: envelope.installationId,
		appRunId,
		environment: envelope.environment,
		isEmployee: primary?.attributes["isEmployee"] === true,
		...(email !== undefined ? { email, cohortId: calculatePeriodId(envelope.timestamp) } : {}),
	};
}
