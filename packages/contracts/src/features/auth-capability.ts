/**
 * Main-process-only capability contract exposed by the auth shell delegate.
 *
 * Consumers resolve this via:
 * ```ts
 * const auth = mainSdk.plugins.get<AuthMainCapability>("auth");
 * const apiKey = await auth?.session.getApiKey();
 * const domain = await auth?.session.getSiteDomain();
 * ```
 *
 * The raw API key is never exposed to the renderer process.
 */
export interface AuthMainCapability extends Record<string, unknown> {
	session: AuthMainCapabilityService;
}

export interface AuthMainCapabilityService {
	/**
	 * Retrieve the currently stored Anaconda API key from the keyring.
	 * Returns `null` when the user is not authenticated or the keyring
	 * is unavailable.
	 */
	getApiKey(): Promise<string | null>;

	/**
	 * The resolved Anaconda site host (e.g. `stage.anaconda.com`, or
	 * `host:port` for self-hosted), for consumers that must derive per-site
	 * API URLs. Defaults to — and falls back to — `anaconda.com` when the
	 * site config cannot be resolved. Main-process only.
	 */
	getSiteDomain(): Promise<string>;
}
