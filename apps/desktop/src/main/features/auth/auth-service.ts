import isEqual from "lodash/isEqual.js";
import memoize from "lodash/memoize.js";

import { Keyring } from "./keyring/keyring.js";
import { login as oauthLogin, type LoginDependencies } from "./oauth/oauth-flow.js";

import type { AuthSession } from "@anaconda-agentic-desktop/contracts";

import {
	exchangeForApiKey,
	getUserPassport,
	passportToUser,
	whoamiResponseSchema,
	type UserInfoAttribute,
	type UserInfoOrganization,
	type UserInfoPassport,
} from "./actions.js";
import { primarySubscriptionFromAttributes, type UserSubscription } from "./utils.js";
import { startLoopbackAuthorize, electronFetch } from "./oauth/callback-server.js";
import {
	resolveSite,
	buildOAuthConfig,
	type ConfigLoader,
	type ResolvedSite,
} from "./config/site.js";
import type {
	AuthLogger,
	KeyringHandle,
	LoopbackAuthorizer,
	OAuthConfig,
	OAuthFetch,
} from "./types.js";
import { createLogger } from "../../platform/logger.js";

export type SiteResolver = (loader?: ConfigLoader) => Promise<ResolvedSite>;

/** Module-level default logger; the constructor accepts an override for tests. */
const defaultLogger = createLogger("auth");

export type KeyringLoader = (site: ResolvedSite) => Promise<KeyringHandle>;

/** Runs the OAuth PKCE flow; matches `./oauth/oauth-flow.js`'s `login`. */
export type OAuthLogin = typeof oauthLogin;

/** Starts the loopback callback server for the given site domain. */
export type AuthorizeServerFactory = (domain: string) => Promise<LoopbackAuthorizer>;

/** Exchanges an access token for an API key; matches `./actions.js`. */
export type ApiKeyExchanger = (
	domain: string,
	accessToken: string,
	fetchImpl: OAuthFetch,
	userAgent: string,
) => Promise<string>;

export type UserPassportFetcher = typeof getUserPassport;

export interface AuthSessionServiceOptions {
	fetch?: OAuthFetch;
	resolveSite?: SiteResolver;
	configLoader?: ConfigLoader;
	loadKeyring?: KeyringLoader;
	login?: OAuthLogin;
	createAuthorizeServer?: AuthorizeServerFactory;
	exchangeForApiKey?: ApiKeyExchanger;
	getUserPassport?: UserPassportFetcher;
	userAgent?: string;
	logger?: AuthLogger;
}

const ANONYMOUS: AuthSession = { status: "anonymous" };

/**
 * Resolves and caches the current Anaconda session by reading the API key from
 * the keyring and fetching the passport (`whoami`). Passive only — no login /
 * logout. `fetch`, site resolution, and keyring loading are injectable for
 * tests; failures degrade to `anonymous`/`error` and never throw to callers.
 */
export class AuthSessionService {
	#session: AuthSession = ANONYMOUS;
	#resolved = false;
	#inFlight: Promise<AuthSession> | undefined;
	#lastApiKey: string | null = null;
	readonly #listeners = new Set<(session: AuthSession) => void>();

	readonly #fetch: OAuthFetch;
	readonly #resolveSite: SiteResolver;
	readonly #configLoader: ConfigLoader | undefined;
	readonly #loadKeyring: KeyringLoader;
	readonly #login: OAuthLogin;
	readonly #createAuthorizeServer: AuthorizeServerFactory;
	readonly #exchangeForApiKey: ApiKeyExchanger;
	readonly #userPassportAction: UserPassportFetcher;
	readonly #userAgent: string;
	readonly #logger: AuthLogger;

	/**
	 * Memoized userinfo passport; cache cleared whenever the session changes.
	 * A rejected fetch is evicted rather than cached so a transient failure does
	 * not stick for the rest of the session — the next call retries. All
	 * passport-derived accessors (`getUserInfo`, `getOrganizations`,
	 * `getSubscription`) share this single cache entry.
	 */
	readonly #passport = memoize(async (): Promise<UserInfoPassport> => {
		const apiKey = await this.getApiKey();
		if (!apiKey) return {};
		try {
			const site = await this.#resolveSite(this.#configLoader);
			return await this.#userPassportAction(site.domain, apiKey, this.#fetch, this.#userAgent);
		} catch (cause) {
			// Do not cache a transient failure: evict this rejected entry so the
			// next getUserInfo()/getSubscription()/getOrganizations() retries once
			// connectivity returns.
			this.#passport.cache.delete?.(undefined);
			throw cause;
		}
	});

	constructor(options: AuthSessionServiceOptions = {}) {
		this.#fetch = options.fetch ?? electronFetch;
		this.#resolveSite = options.resolveSite ?? resolveSite;
		this.#configLoader = options.configLoader;
		this.#loadKeyring = options.loadKeyring ?? ((site) => Keyring.load(site));
		this.#login = options.login ?? oauthLogin;
		this.#createAuthorizeServer =
			options.createAuthorizeServer ?? ((domain) => startLoopbackAuthorize({ domain }));
		this.#exchangeForApiKey = options.exchangeForApiKey ?? exchangeForApiKey;
		this.#userPassportAction = options.getUserPassport ?? getUserPassport;
		this.#userAgent = options.userAgent ?? "anaconda-agentic-desktop";
		this.#logger = options.logger ?? defaultLogger;
	}

	/** Current cached session without triggering resolution. */
	peek(): AuthSession {
		return this.#session;
	}

	/**
	 * Retrieve the currently stored API key from the keyring.
	 * Returns `null` when there is no key or the keyring is unavailable.
	 * This method is main-process-only; the key never crosses to the renderer.
	 */
	async getApiKey(): Promise<string | null> {
		try {
			const site = await this.#resolveSite(this.#configLoader);
			const keyring = await this.#loadKeyring(site);
			return await keyring.getApiKey();
		} catch {
			return null;
		}
	}

	/** Resolve lazily; subsequent calls return the cached value. */
	async getSession(): Promise<AuthSession> {
		if (this.#resolved) return this.#session;
		return this.#resolve();
	}

	/** Force a re-resolution of the session. */
	async refresh(): Promise<AuthSession> {
		this.#resolved = false;
		return this.#resolve();
	}

	/**
	 * The persisted Anaconda API key, which also acts as the access token for
	 * downstream requests. `null` when absent or unavailable; never throws.
	 */
	async getApiKey(): Promise<string | null> {
		try {
			const site = await this.#resolveSite(this.#configLoader);
			const keyring = await this.#loadKeyring(site);
			return await keyring.getApiKey();
		} catch {
			return null;
		}
	}

	/**
	 * OIDC userinfo passport attributes for the current session, memoized until
	 * the session changes. Empty list when anonymous or when the passport is
	 * genuinely empty. Rejects on a transient fetch failure (not cached), so a
	 * subsequent call retries.
	 */
	async getUserInfo(): Promise<UserInfoAttribute[]> {
		return (await this.#passport()).attributes ?? [];
	}

	/**
	 * Organizations the authenticated user belongs to. Empty list when anonymous
	 * or when the passport carries no organizations. Shares the memoized
	 * passport cache with `getUserInfo`/`getSubscription`; propagates a
	 * transient fetch rejection.
	 */
	async getOrganizations(): Promise<UserInfoOrganization[]> {
		return (await this.#passport()).organizations ?? [];
	}

	/**
	 * The resolved primary subscription tier for the current session. Single
	 * shared entry point for consumers (feature flags, telemetry) so the tier is
	 * derived once from userinfo attributes rather than duplicated per consumer.
	 * Propagates a userinfo fetch rejection; consumers guard with `.catch`.
	 */
	async getSubscription(): Promise<UserSubscription> {
		return primarySubscriptionFromAttributes(await this.getUserInfo());
	}

	/**
	 * Run the interactive OAuth login: open the browser, exchange the returned
	 * access token for an API key, persist it to the keyring, then re-resolve
	 * the session (emitting `auth:changed`). User-initiated, so it does NOT go
	 * through the `refresh()` in-flight dedupe. Failures never throw across the
	 * IPC boundary — they resolve to an `error` session.
	 */
	async login(): Promise<AuthSession> {
		try {
			const site = await this.#resolveSite(this.#configLoader);
			const baseConfig = buildOAuthConfig(site);
			if (!baseConfig.clientId) {
				return {
					status: "error",
					reason: "No OAuth client ID configured (set VITE_AUTH_CLIENT_ID or site.client_id).",
				};
			}

			// Start the loopback callback server first: it owns the concrete
			// `redirect_uri` (host/port it actually bound to), which must match the
			// value baked into the authorization URL and registered with the client.
			const authorizer = await this.#createAuthorizeServer(site.domain);
			const oauthConfig: OAuthConfig = { ...baseConfig, redirectUrl: authorizer.redirectUrl };

			this.#logger.info(
				`login: domain=${oauthConfig.domain} redirectUrl=${oauthConfig.redirectUrl}` +
					`${oauthConfig.issuerUrl ? ` issuer=${oauthConfig.issuerUrl}` : ""}`,
			);

			const tokens = await this.#login(oauthConfig, {
				authorize: authorizer.authorize,
				// `OAuthFetch` (native `RequestInit`) is structurally compatible with
				// openid-client's `CustomFetch`; the only nominal gap is `body`
				// including `undefined`, which `exactOptionalPropertyTypes` rejects.
				fetch: this.#fetch as LoginDependencies["fetch"],
			});
			this.#logger.info("login: received access token, exchanging for API key…");

			const apiKey = await this.#exchangeForApiKey(
				site.domain,
				tokens.access_token,
				this.#fetch,
				this.#userAgent,
			);

			const keyring = await this.#loadKeyring(site);
			if (!keyring.writable) {
				return { status: "error", reason: "Keyring is read-only; cannot persist API key." };
			}
			await keyring.saveToken({ api_key: apiKey });
			this.#logger.info("login: API key saved to keyring");
		} catch (cause) {
			// Login is fire-and-forget across IPC (returns an error session rather
			// than throwing), so log the underlying cause here — otherwise the
			// failure is invisible in the main-process log.
			this.#logger.error("login failed:", cause);
			return { status: "error", reason: errorReason(cause) };
		}

		return this.refresh();
	}

	/** Delete the persisted API key and publish an anonymous session. */
	async logout(): Promise<AuthSession> {
		try {
			const site = await this.#resolveSite(this.#configLoader);
			const keyring = await this.#loadKeyring(site);
			if (!keyring.writable) {
				return { status: "error", reason: "Keyring is read-only; cannot delete API key." };
			}
			await keyring.deleteToken();
			this.#logger.info("logout: API key deleted from keyring");
		} catch (cause) {
			this.#logger.error("logout failed:", cause);
			return { status: "error", reason: errorReason(cause) };
		}

		this.#resolved = true;
		this.#commit(ANONYMOUS, null);
		return ANONYMOUS;
	}

	/** Subscribe to session transitions. Returns an unsubscribe function. */
	onChanged(listener: (session: AuthSession) => void): () => void {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	/** Stop fanning out to subscribers. Call on app/service teardown. */
	dispose(): void {
		this.#listeners.clear();
	}

	#resolve(): Promise<AuthSession> {
		this.#inFlight ??= this.#doResolve().finally(() => {
			this.#inFlight = undefined;
		});
		return this.#inFlight;
	}

	async #doResolve(): Promise<AuthSession> {
		const { session: next, apiKey } = await this.#computeSession();
		this.#resolved = true;
		this.#commit(next, apiKey);
		return next;
	}

	async #computeSession(): Promise<{ session: AuthSession; apiKey: string | null }> {
		let site: ResolvedSite;
		try {
			site = await this.#resolveSite(this.#configLoader);
		} catch (cause) {
			return { session: { status: "error", reason: errorReason(cause) }, apiKey: null };
		}

		let apiKey: string | null;
		try {
			const keyring = await this.#loadKeyring(site);
			apiKey = await keyring.getApiKey();
		} catch {
			// Keyring unavailable → treat as no session rather than crashing.
			return { session: ANONYMOUS, apiKey: null };
		}

		if (!apiKey) return { session: ANONYMOUS, apiKey: null };

		return { session: await this.#fetchSession(site, apiKey), apiKey };
	}

	async #fetchSession(site: ResolvedSite, apiKey: string): Promise<AuthSession> {
		const url = `https://${site.domain}/api/auth/sessions/whoami`;

		let response: Response;
		try {
			response = await this.#fetch(url, {
				method: "GET",
				headers: { Authorization: `Bearer ${apiKey}` },
			});
		} catch (cause) {
			return { status: "error", reason: errorReason(cause) };
		}

		// Invalid/expired key → anonymous (drop the in-memory key; keep keyring).
		if (response.status === 401 || response.status === 403) {
			return ANONYMOUS;
		}
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

	#commit(next: AuthSession, apiKey?: string | null): void {
		const sessionChanged = !isEqual(this.#session, next);
		const keyChanged = apiKey !== undefined && apiKey !== this.#lastApiKey;
		if (apiKey !== undefined) this.#lastApiKey = apiKey;
		this.#session = next;
		if (sessionChanged || keyChanged) {
			// Clear the passport (userinfo) cache only when the session
			// identity itself changed — a bare key rotation preserves the
			// user, so cached passport attributes are still valid.
			if (sessionChanged) this.#passport.cache.clear?.();
			for (const listener of this.#listeners) listener(next);
		}
	}
}

function errorReason(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
