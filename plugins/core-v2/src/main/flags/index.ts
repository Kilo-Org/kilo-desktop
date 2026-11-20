import { KernelFlagSource, KernelService, type PluginSdk } from "@kilo-desktop/kernel";

import { LaunchDarklyFlagSource } from "./flag-source";
import type { FeatureFlagProvider } from "./types";

export type { FeatureFlagProvider } from "./types";

export interface FlagsOptions {
	/** Creates the flag backend: LaunchDarkly, or defaults only when it isn't configured. */
	readonly createProvider: () => FeatureFlagProvider;
}

/**
 * The flags area: LaunchDarkly as the kernel's flag source (`launchdarkly`).
 * The kernel owns flag declarations, values, overrides and `kernel/flag:*`
 * context keys; this area only answers for the identity the kernel passes
 * in. LaunchDarkly runs as a supervised daemon so the kernel shows it in
 * Diagnostics and closes it on quit.
 */
export function activateFlags(sdk: PluginSdk, options: FlagsOptions): void {
	const source = new LaunchDarklyFlagSource({
		provider: options.createProvider(),
		logger: sdk.logger,
	});
	sdk.extensions.implement(KernelFlagSource, "launchdarkly", source);
	sdk.extensions.implement(KernelService, "launchdarkly", {
		start: () => source.start(),
		stop: () => source.dispose(),
	});
}
