import type { KernelLogger } from "@kilo-desktop/kernel";

/** Structural logger seam so tests can pass a no-op logger. */
export type OAuthLogger = Pick<KernelLogger, "info" | "warn" | "error">;

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
 * call sites (`actions.ts`, `AnacondaAccountService.ts`) don't need to depend on
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
	/** Opens the pending authorization URL again; resolves `false` when none is pending. */
	reopen: () => Promise<boolean>;
	/** Ends the wait with `OAuthCancelledError` and frees the port. */
	cancel: () => void;
}
