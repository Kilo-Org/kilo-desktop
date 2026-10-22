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
	/**
	 * Effective consent for usage analytics and crash reporting — what telemetry
	 * sinks enforce. Enabled when unset; saved opt-outs are preserved. Always
	 * false in builds that force collection off (e2e).
	 */
	readonly allowDataCollection: boolean;
	/** The user's saved setting shown in Privacy settings; may differ from effective consent. */
	readonly dataCollectionChoice: boolean;
	/** Saves the user's choice. */
	setAllowDataCollection(allow: boolean): Promise<void>;
	/**
	 * Listeners receive effective consent. Changes are applied one at a time in
	 * call order. The setter resolves once every listener has finished and
	 * rejects if any listener fails.
	 */
	onDidChangeAllowDataCollection(listener: (allow: boolean) => void | Promise<void>): () => void;

	/**
	 * The telemetry environment attribute (`"development"`, `"test"`, or `"production"`).
	 * Derived from the build-time `VITE_ANACONDA_LOGGING_ENV_ATTRIBUTE`; defaults
	 * to `"production"` when the build variable is unset.
	 */
	readonly telemetryEnv: string;

	/**
	 * Desktop's stable anonymous installation id. Plugins stamp it on
	 * telemetry-bearing subprocesses (e.g. `KILO_MACHINE_ID` for the Kilo CLI)
	 * so every Desktop-controlled surface reports one machine identity.
	 */
	readonly installationId: string;
}
