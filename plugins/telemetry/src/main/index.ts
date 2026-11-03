import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import { createTelemetryMainEntry, type ProviderConfig } from "./entry";
import { PostHogProvider } from "./provider";
import type { TelemetryProvider } from "./types";

export { createTelemetryMainEntry } from "./entry";

const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

function posthog(sdk: PluginSdk, config: ProviderConfig): TelemetryProvider {
	return new PostHogProvider({
		config: {
			// Unset in source builds, which then send nothing (see PostHogProvider).
			posthogKey: import.meta.env.VITE_POSTHOG_KEY ?? "",
			posthogHost: import.meta.env.VITE_POSTHOG_HOST || POSTHOG_DEFAULT_HOST,
			environment: config.environment,
			serviceId: "kilo-desktop",
			serviceVersion: config.appVersion,
		},
		logger: sdk.logger,
		fetch: mainHost(sdk).net.fetch,
	});
}

/** kilo.telemetry's main-process entry, sending to PostHog. */
export const telemetryMainEntry = createTelemetryMainEntry({ createProvider: posthog });
