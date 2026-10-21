import type { AuthSession } from "./auth.js";

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

	/** Store an Anaconda API key in the keyring. Rejects when the keyring is read-only. */
	saveApiKey(apiKey: string): Promise<void>;

	/**
	 * Remove the stored Anaconda API key, keeping the rest of the shared keyring
	 * entry (e.g. repo tokens). Rejects when the keyring is read-only.
	 */
	deleteApiKey(): Promise<void>;

	/**
	 * The resolved Anaconda site host (e.g. `stage.anaconda.com`, or
	 * `host:port` for self-hosted), for consumers that must derive per-site
	 * API URLs. Defaults to — and falls back to — `anaconda.com` when the
	 * site config cannot be resolved. Main-process only.
	 */
	getSiteDomain(): Promise<string>;

	/** Site settings for the Anaconda OAuth flow. Rejects when the config can't be resolved. */
	getOAuthSettings(): Promise<AnacondaOAuthSettings>;

	/** The current session, re-resolved when the cached one may be stale. */
	getSession(): Promise<AuthSession>;
}

/** Resolved settings for the Anaconda OAuth sign-in flow. */
export interface AnacondaOAuthSettings {
	/** Site host, e.g. `anaconda.com` (or `host:port` when self-hosted). */
	domain: string;
	/** OAuth client id; empty when neither the site config nor the build provides one. */
	clientId: string;
	/** OIDC issuer override (`https://<auth_domain_override>`). */
	issuerUrl?: string;
	/** Tag recorded on the API key created by sign-in (`kilo-desktop/<version>`). */
	userAgent: string;
}
