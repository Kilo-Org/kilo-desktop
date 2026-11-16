import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import type { TelemetryOptions } from "./index";
import { PostHogProvider } from "./provider";

const POSTHOG_DEFAULT_HOST = "https://us.i.posthog.com";

/** PostHog over the host's network fetch, configured from the build environment. */
export function productionTelemetryOptions(sdk: PluginSdk): TelemetryOptions {
	return {
		createProvider: ({ appVersion }) =>
			new PostHogProvider({
				config: {
					// Unset in source builds, which then send nothing (see PostHogProvider).
					posthogKey: import.meta.env.VITE_POSTHOG_KEY ?? "",
					posthogHost: import.meta.env.VITE_POSTHOG_HOST || POSTHOG_DEFAULT_HOST,
					serviceId: "kilo-desktop",
					serviceVersion: appVersion,
				},
				logger: sdk.logger,
				fetch: mainHost(sdk).net.fetch,
			}),
	};
}
