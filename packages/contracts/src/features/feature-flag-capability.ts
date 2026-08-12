/**
 * Main-process-only capability contract exposed by the feature-flag service.
 *
 * Consumers resolve this via:
 * ```ts
 * const ff = mainSdk.plugins.get<FeatureFlagMainCapability>("feature-flag");
 * const enabled = ff?.featureFlag.getFlag("some-key", false) ?? false;
 * ```
 *
 * Flag changes are also relayed to the feature event bus as
 * `feature-flag.changed` with the full flag map — features that need to
 * react to a flag toggle should subscribe via `mainSdk.events.on(...)`
 * rather than polling.
 */
export interface FeatureFlagMainCapability extends Record<string, unknown> {
	featureFlag: FeatureFlagMainCapabilityService;
}

export interface FeatureFlagMainCapabilityService {
	/**
	 * Read a feature flag synchronously with a default value.
	 *
	 * Errors during evaluation resolve to the default — the underlying
	 * service swallows and logs provider failures so callers always get
	 * a value.
	 */
	getFlag<T>(key: string, defaultValue: T): T;
}
