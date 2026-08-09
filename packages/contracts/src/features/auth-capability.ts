/**
 * Main-process-only capability contract exposed by the auth shell delegate.
 *
 * Consumers resolve this via:
 * ```ts
 * const auth = mainSdk.plugins.get<AuthMainCapability>("auth");
 * const apiKey = await auth?.auth.getApiKey();
 * ```
 *
 * The raw API key is never exposed to the renderer process.
 */
export interface AuthMainCapability extends Record<string, unknown> {
	auth: AuthMainCapabilityService;
}

export interface AuthMainCapabilityService {
	/**
	 * Retrieve the currently stored Anaconda API key from the keyring.
	 * Returns `null` when the user is not authenticated or the keyring
	 * is unavailable.
	 */
	getApiKey(): Promise<string | null>;
}
