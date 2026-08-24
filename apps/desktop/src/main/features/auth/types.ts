import type { Logger } from "../../platform/logger.js";
import type { Keyring } from "./keyring/keyring.js";

// Logging

/** Structural logger seam so tests can silence/inspect log output. */
export type AuthLogger = Pick<Logger, "info" | "warn" | "error">;

// Keyring

export interface RepoToken {
	token: string;
	org_name?: string | null | undefined;
}

export interface TokenPayload {
	domain: string;
	api_key?: string | null | undefined;
	username?: string | null | undefined;
	user_id?: string | null | undefined;
	repo_tokens?: RepoToken[] | null | undefined;
	version?: number | null | undefined;
}

export type KeyringFile = Record<string, Record<string, string>>;

export interface KeyringBackend {
	readonly name: string;
	readonly priority: number;
	/** Whether saveToken/deleteToken can persist; read-only backends report false. */
	readonly writable: boolean;
	getToken(domain: string): Promise<TokenPayload | null>;
	saveToken(domain: string, payload: TokenPayload): Promise<void>;
	deleteToken(domain: string): Promise<void>;
}

/** Minimal keyring surface `AuthSessionService` depends on, derived from `Keyring` itself. */
export type KeyringHandle = Pick<Keyring, "getApiKey" | "saveToken" | "deleteToken" | "writable">;

// OAuth

/**
 * Configuration for the OAuth PKCE login flow. Also used to build the
 * authorization request in `AuthSessionService.login`.
 */
export interface OAuthConfig {
	/** Base domain for OIDC discovery (e.g. "anaconda.com") */
	domain: string;
	/** OAuth client ID (e.g. from import.meta.env.VITE_AUTH_CLIENT_ID) */
	clientId: string;
	/**
	 * The redirect URL for the OAuth callback. For desktop this is the loopback
	 * URL the app's local callback server listens on
	 * (e.g. "http://127.0.0.1:8000/auth/oidc").
	 */
	redirectUrl: string;
	/**
	 * Full issuer URL override (e.g. "http://localhost:8080").
	 * When set, used directly for OIDC discovery instead of constructing https://{domain}.
	 */
	issuerUrl?: string | undefined;
	/** Scopes to request. Defaults to ["openid", "email", "profile"]. */
	scopes?: string[] | undefined;
	/**
	 * Allow insecure HTTP requests (for development/testing only).
	 * When true, disables the HTTPS-only restriction on OIDC discovery and token exchange.
	 */
	allowInsecureRequests?: boolean | undefined;
}

/**
 * Fetch matching openid-client's `CustomFetch` contract. Named locally so
 * call sites (`actions.ts`, `auth-service.ts`) don't need to depend on
 * `openid-client` directly; structurally assignable to
 * `LoginDependencies["fetch"]` at the call site.
 */
export type OAuthFetch = (url: string, options: RequestInit) => Promise<Response>;

/**
 * Opens the authorization URL in the system browser and resolves with the full
 * callback URL once the loopback server receives the redirect. Rejects on
 * browser-open failure or after the authorize timeout; the caller maps that to
 * an `error` session so the UI can re-enable the Sign In button.
 */
export type Authorize = (authorizationUrl: string) => Promise<string>;

/** A started loopback callback server plus the redirect URL it is bound to. */
export interface LoopbackAuthorizer {
	/** The `http://127.0.0.1:8000/auth/oidc` the server is bound to. */
	redirectUrl: string;
	/** Opens the browser and awaits the single callback request. */
	authorize: Authorize;
	/** Closes the server without opening the browser (e.g. abort before authorize). */
	close: () => void;
}
