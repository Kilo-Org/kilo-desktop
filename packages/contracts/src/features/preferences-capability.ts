/**
 * Main-process-only capability contract exposed by the preferences shell
 * delegate.
 *
 * Consumers resolve this via:
 * ```ts
 * const prefs = mainSdk.plugins.get<PreferencesMainCapability>("preferences");
 * const allowed = prefs?.preferences.allowDataCollection ?? false;
 * ```
 *
 * The shell owns persistence; settings and runtime enforcement share this authority.
 */
export interface PreferencesMainCapability extends Record<string, unknown> {
	preferences: PreferencesMainCapabilityService;
}

export interface PreferencesMainCapabilityService {
	/** Usage analytics and crash reporting. Enabled when unset; saved opt-outs are preserved. */
	readonly allowDataCollection: boolean;
	setAllowDataCollection(allow: boolean): Promise<void>;
	/**
	 * Changes are applied one at a time in call order. The setter resolves once
	 * every listener has finished and rejects if any listener fails.
	 */
	onDidChangeAllowDataCollection(listener: (allow: boolean) => void | Promise<void>): () => void;

	/**
	 * The telemetry environment attribute (`"development"`, `"test"`, or `"production"`).
	 * Derived from the build-time `VITE_ANACONDA_LOGGING_ENV_ATTRIBUTE`; defaults
	 * to `"production"` when the build variable is unset.
	 */
	readonly telemetryEnv: string;
}
