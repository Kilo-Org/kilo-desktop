import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { ProviderRegistry } from "./ProviderRegistry.js";
import { CondaProvider } from "./providers/conda/index.js";

/**
 * LaunchDarkly feature-flag key gating the entire environments plugin.
 *
 * When this evaluates to `false` (the default, used when the flag is missing,
 * the provider errors, the user is not in an enabled cohort, or the
 * feature-flag capability itself is unavailable) the plugin contributes
 * nothing at boot: no providers boot, no channel handlers register, and the
 * conda staging pipeline never runs.
 *
 * Kept in sync with the renderer-side constant in
 * `plugins/environments/src/web/EnvironmentsPage.tsx`.
 */
export const FEATURE_FLAG_KEY = "environments-feature";

/**
 * Minimal shape of the main-side feature-flag capability exposed by the
 * shell (see `packages/contracts/src/features/feature-flag-capability.ts`).
 * Inlined so the plugin does not take a `@anaconda-agentic-desktop/contracts`
 * dependency for a single call.
 */
interface FeatureFlagCapability extends Record<string, unknown> {
	featureFlag: {
		getFlag<T>(key: string, defaultValue: T): T;
	};
}

/**
 * Main-process registration for the `environments` plugin.
 *
 * Gated on the `environments-feature` LaunchDarkly flag. When the flag is
 * off (or the flag capability is unavailable) `mainRegister` short-circuits
 * before staging conda — the boot path stays fast and the plugin behaves as
 * if it were absent from the manifest.
 *
 * When enabled: boots registered providers sequentially (staging is one-time,
 * first-launch work), then binds their handlers. Async so the shell can
 * await staging and deliver progress to the splash throughout.
 *
 * The gate reads the real LaunchDarkly value at boot because
 * `Application#registerIpc` awaits `FeatureFlagService.initialize()` before
 * `bootFeatures` runs. Flipping the flag while the app is running does NOT
 * re-run staging or dispose of providers — a flag toggle only takes effect
 * on next launch. The `feature-flag.changed` reconcile pattern used by
 * anaconda-mcp is intentionally not adopted here because conda staging is a
 * one-shot boot-time pipeline.
 */
export async function mainRegister(mainSdk: MainSdk): Promise<void> {
	const featureFlag = mainSdk.plugins.get<FeatureFlagCapability>("feature-flag");
	const flagEnabled = featureFlag?.featureFlag.getFlag<boolean>(FEATURE_FLAG_KEY, false) ?? false;
	if (!flagEnabled) {
		mainSdk.logger.info("boot skipped: environments-feature flag is off");
		return;
	}

	const registry = new ProviderRegistry();
	registry.register(new CondaProvider());

	for (const provider of registry.list()) {
		if (provider.boot) {
			await provider.boot({ mainSdk, boot: mainSdk.boot, logger: mainSdk.logger });
		}
	}

	// Handlers are registered AFTER all providers have booted so they never
	// serve requests against a not-yet-staged conda binary.
	for (const provider of registry.list()) {
		provider.registerHandlers({ mainSdk });
	}

	mainSdk.logger.info(`boot: ${registry.list().length} provider(s) registered`);
}
