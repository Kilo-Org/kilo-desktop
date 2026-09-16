/**
 * Main-process-only capability contract exposed by the preferences shell
 * delegate.
 *
 * Consumers resolve this via:
 * ```ts
 * const prefs = mainSdk.plugins.get<PreferencesMainCapability>("preferences");
 * const allowed = prefs?.preferences.allowDataCollection ?? true;
 * ```
 *
 * The capability is read-only — plugins can observe the current preference
 * but cannot change it; the shell owns the settings UI and persistence.
 */
export interface PreferencesMainCapability extends Record<string, unknown> {
	preferences: PreferencesMainCapabilityService;
}

export interface PreferencesMainCapabilityService {
	/** Whether the user has opted into anonymous data collection. Defaults `true` (opt-out model). */
	readonly allowDataCollection: boolean;

	/**
	 * The telemetry environment attribute (`"development"`, `"test"`, or `"production"`).
	 * Derived from the build-time `VITE_ANACONDA_LOGGING_ENV_ATTRIBUTE`; defaults
	 * to `"production"` when the build variable is unset.
	 */
	readonly telemetryEnv: string;
}
