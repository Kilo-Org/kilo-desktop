import isEqual from "lodash/isEqual.js";

import type { AnacondaAccountSession } from "../contracts/schemas.js";

import { exchangeForApiKey, passportToUser, whoamiResponseSchema } from "./actions.js";
import { startLoopbackAuthorize } from "./oauth/callback-server.js";
import { OAuthCancelledError } from "./oauth/errors.js";
import { login as oauthLogin, type LoginDependencies } from "./oauth/oauth-flow.js";
import type { LoopbackAuthorizer, OAuthFetch, OAuthLogger } from "./oauth/types.js";

/**
 * Structural mirror of the slice of the shell's main-side `auth` capability
 * (`mainSdk.plugins.get("auth").session`) this plugin uses. The shell owns the
 * Anaconda keyring and the site config; this plugin only adds the sign-in.
 */
export interface AnacondaCredentials {
	getApiKey(): Promise<string | null>;
	getOAuthSettings(): Promise<AnacondaOAuthSettings>;
	saveApiKey(apiKey: string): Promise<void>;
	deleteApiKey(): Promise<void>;
}

export interface AnacondaOAuthSettings {
	domain: string;
	clientId: string;
	issuerUrl?: string;
	/** Tag recorded on the created API key (`kilo-desktop/<version>`). */
	userAgent?: string;
}

/** Runs the OAuth PKCE flow; matches `./oauth/oauth-flow.js`'s `login`. */
export type OAuthLogin = typeof oauthLogin;

/** Starts the loopback callback server for the given site domain. */
export type AuthorizeServerFactory = (domain: string) => Promise<LoopbackAuthorizer>;

/** Exchanges an access token for an API key; matches `./actions.js`. */
export type ApiKeyExchanger = typeof exchangeForApiKey;

export interface AnacondaAccountServiceOptions {
	/** Resolved lazily per call: the shell capability may register after this plugin. */
	credentials: () => AnacondaCredentials | null;
	fetch: OAuthFetch;
	/** Opens the system browser; absent outside Electron (sign-in then reports an error). */
	openExternal: ((url: string) => Promise<boolean>) | undefined;
	logger: OAuthLogger;
	login?: OAuthLogin;
	createAuthorizeServer?: AuthorizeServerFactory;
	exchangeForApiKey?: ApiKeyExchanger;
}

const ANONYMOUS: AnacondaAccountSession = { status: "anonymous" };
const CREDENTIALS_UNAVAILABLE = "Anaconda sign-in is unavailable.";

/**
 * The Anaconda account: a convenience credential source for features that call
 * Anaconda APIs (model catalog). It is NOT the app session — app identity is
 * Kilo-backed and owned by the shell.
 *
 * Ownership: the shell owns the keyring and site config (via the `auth`
 * capability); this service owns the OAuth loopback sign-in, the token→API-key
 * exchange, and the derived session. Signing in writes the key through the
 * shell; signing out deletes it. A key placed by any other tool (e.g.
 * `anaconda login`) reads the same way.
 *
 * Invariants: the session is derived from the stored key via `whoami` and
 * cached until `refresh()`/`login()`/`logout()`; concurrent refreshes share
 * one resolve, and concurrent sign-ins share one OAuth flow (there is only one
 * registered loopback port, so a second flow could never bind); a repeated
 * sign-in reopens the pending authorization page, and a cancel ends the flow
 * quietly. The loopback server is always closed when a sign-in ends, however
 * it ends. Listeners fire when the session OR the underlying key changes,
 * so key-derived consumers can refetch on a silent rotation. Every public
 * method resolves to a session — failures become `error`/`anonymous`, never a
 * rejection — and the key itself never leaves the main process.
 */
export class AnacondaAccountService {
	#session: AnacondaAccountSession = ANONYMOUS;
	#resolved = false;
	#inFlight: Promise<AnacondaAccountSession> | undefined;
	#loginInFlight: Promise<AnacondaAccountSession> | undefined;
	#pendingAuthorizer: LoopbackAuthorizer | undefined;
	#loginCancelled = false;
	#lastApiKey: string | null = null;
	readonly #listeners = new Set<(session: AnacondaAccountSession) => void>();

	readonly #credentials: () => AnacondaCredentials | null;
	readonly #fetch: OAuthFetch;
	readonly #logger: OAuthLogger;
	readonly #login: OAuthLogin;
	readonly #createAuthorizeServer: AuthorizeServerFactory | undefined;
	readonly #exchangeForApiKey: ApiKeyExchanger;

	constructor(options: AnacondaAccountServiceOptions) {
		this.#credentials = options.credentials;
		this.#fetch = options.fetch;
		this.#logger = options.logger;
		this.#login = options.login ?? oauthLogin;
		const { openExternal, logger } = options;
		this.#createAuthorizeServer =
			options.createAuthorizeServer ??
			(openExternal
				? (domain) => startLoopbackAuthorize({ domain, openExternal, logger })
				: undefined);
		this.#exchangeForApiKey = options.exchangeForApiKey ?? exchangeForApiKey;
	}

	/** Resolve lazily; subsequent calls return the cached value. */
	async getSession(): Promise<AnacondaAccountSession> {
		if (this.#resolved) return this.#session;
		return this.#resolve();
	}

	/** Force a re-resolution (e.g. after a key was written by another tool). */
	async refresh(): Promise<AnacondaAccountSession> {
		this.#resolved = false;
		return this.#resolve();
	}

	/**
	 * Run the interactive OAuth sign-in: open the browser, exchange the returned
	 * access token for an API key, store it through the shell, then re-resolve.
	 * Callers that arrive while a sign-in is running (another window, the
	 * catalog and the Account page) share its outcome, and the pending
	 * authorization page is opened again — the user may have closed the tab or
	 * used the wrong browser profile.
	 */
	login(): Promise<AnacondaAccountSession> {
		if (this.#loginInFlight) {
			void this.#pendingAuthorizer?.reopen();
			return this.#loginInFlight;
		}
		this.#loginInFlight = this.#runLogin().finally(() => {
			this.#loginInFlight = undefined;
		});
		return this.#loginInFlight;
	}

	/**
	 * Cancel a pending sign-in: frees the loopback port, and the pending
	 * `login()` resolves to the current session without an error. No-op when
	 * no sign-in is running.
	 */
	cancelLogin(): void {
		if (!this.#loginInFlight) return;
		this.#loginCancelled = true;
		this.#pendingAuthorizer?.cancel();
	}

	async #runLogin(): Promise<AnacondaAccountSession> {
		this.#loginCancelled = false;
		const credentials = this.#credentials();
		if (!credentials || !this.#createAuthorizeServer) {
			return { status: "error", reason: CREDENTIALS_UNAVAILABLE };
		}
		let authorizer: LoopbackAuthorizer | undefined;
		try {
			const settings = await credentials.getOAuthSettings();
			if (!settings.clientId) {
				return {
					status: "error",
					reason: "No OAuth client ID configured (set VITE_AUTH_CLIENT_ID or site.client_id).",
				};
			}

			// Start the loopback callback server first: it owns the concrete
			// `redirect_uri` (host/port it actually bound to), which must match the
			// value baked into the authorization URL and registered with the client.
			authorizer = await this.#createAuthorizeServer(settings.domain);
			this.#pendingAuthorizer = authorizer;
			// Cancelled while the settings or server were still being prepared.
			if (this.#loginCancelled) authorizer.cancel();
			const { redirectUrl } = authorizer;
			this.#logger.info(
				`login: domain=${settings.domain} redirectUrl=${redirectUrl}` +
					`${settings.issuerUrl ? ` issuer=${settings.issuerUrl}` : ""}`,
			);

			const tokens = await this.#login(
				{
					domain: settings.domain,
					clientId: settings.clientId,
					redirectUrl,
					...(settings.issuerUrl ? { issuerUrl: settings.issuerUrl } : {}),
				},
				{
					authorize: authorizer.authorize,
					// `OAuthFetch` (native `RequestInit`) is structurally compatible with
					// openid-client's `CustomFetch`; the only nominal gap is `body`
					// including `undefined`, which `exactOptionalPropertyTypes` rejects.
					fetch: this.#fetch as LoginDependencies["fetch"],
				},
			);
			this.#logger.info("login: received access token, exchanging for API key…");

			const apiKey = await this.#exchangeForApiKey(
				settings.domain,
				tokens.access_token,
				this.#fetch,
				settings.userAgent ?? "kilo-desktop",
			);
			await credentials.saveApiKey(apiKey);
			this.#logger.info("login: API key saved to keyring");
		} catch (cause) {
			if (cause instanceof OAuthCancelledError) {
				this.#logger.info("login: cancelled");
				return this.#session;
			}
			// Login resolves to an error session rather than throwing, so log the
			// cause here — otherwise the failure is invisible in the main log.
			this.#logger.error("login failed:", cause);
			return { status: "error", reason: errorReason(cause) };
		} finally {
			// `authorize` closes the server once it runs, but a failure before it
			// (e.g. OIDC discovery) would otherwise hold the port until restart.
			authorizer?.close();
			this.#pendingAuthorizer = undefined;
		}

		return this.refresh();
	}

	/** Delete the stored API key and publish an anonymous session. */
	async logout(): Promise<AnacondaAccountSession> {
		const credentials = this.#credentials();
		if (!credentials) return { status: "error", reason: CREDENTIALS_UNAVAILABLE };
		try {
			await credentials.deleteApiKey();
			this.#logger.info("logout: API key deleted from keyring");
		} catch (cause) {
			this.#logger.error("logout failed:", cause);
			return { status: "error", reason: errorReason(cause) };
		}

		this.#resolved = true;
		this.#commit(ANONYMOUS, null);
		return ANONYMOUS;
	}

	/** Subscribe to session/key transitions. Returns an unsubscribe function. */
	onChanged(listener: (session: AnacondaAccountSession) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	dispose(): void {
		this.#listeners.clear();
	}

	#resolve(): Promise<AnacondaAccountSession> {
		this.#inFlight ??= this.#doResolve().finally(() => {
			this.#inFlight = undefined;
		});
		return this.#inFlight;
	}

	async #doResolve(): Promise<AnacondaAccountSession> {
		const { session, apiKey } = await this.#computeSession();
		this.#resolved = true;
		this.#commit(session, apiKey);
		return session;
	}

	async #computeSession(): Promise<{
		session: AnacondaAccountSession;
		apiKey: string | null;
	}> {
		const credentials = this.#credentials();
		if (!credentials) {
			return { session: { status: "error", reason: CREDENTIALS_UNAVAILABLE }, apiKey: null };
		}

		// The shell's getApiKey already degrades keyring failures to null.
		const apiKey = await credentials.getApiKey();
		if (!apiKey) return { session: ANONYMOUS, apiKey: null };

		let domain: string;
		try {
			domain = (await credentials.getOAuthSettings()).domain;
		} catch (cause) {
			return { session: { status: "error", reason: errorReason(cause) }, apiKey };
		}
		return { session: await this.#whoami(domain, apiKey), apiKey };
	}

	async #whoami(domain: string, apiKey: string): Promise<AnacondaAccountSession> {
		let response: Response;
		try {
			response = await this.#fetch(`https://${domain}/api/auth/sessions/whoami`, {
				method: "GET",
				headers: { Authorization: `Bearer ${apiKey}` },
			});
		} catch (cause) {
			return { status: "error", reason: errorReason(cause) };
		}

		// Invalid/expired key → anonymous (the keyring entry is left in place).
		if (response.status === 401 || response.status === 403) return ANONYMOUS;
		if (!response.ok) {
			return { status: "error", reason: `whoami request failed (${response.status})` };
		}

		try {
			const payload = whoamiResponseSchema.parse(await response.json());
			return { status: "authenticated", user: passportToUser(payload) };
		} catch (cause) {
			return { status: "error", reason: errorReason(cause) };
		}
	}

	#commit(next: AnacondaAccountSession, apiKey: string | null): void {
		const sessionChanged = !isEqual(this.#session, next);
		const keyChanged = apiKey !== this.#lastApiKey;
		this.#lastApiKey = apiKey;
		this.#session = next;
		if (sessionChanged || keyChanged) {
			for (const listener of this.#listeners) listener(next);
		}
	}
}

function errorReason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
