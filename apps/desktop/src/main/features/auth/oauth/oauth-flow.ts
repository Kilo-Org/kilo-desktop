import * as client from "openid-client";
import type { CustomFetch, ServerMetadata } from "openid-client";
import type { OAuthConfig } from "../types.js";
import { OAuthDiscoveryError, OAuthCallbackError, OAuthTokenError } from "../errors.js";

/**
 * Injectable dependencies for the OAuth login flow, keeping the protocol logic
 * pure and free of any platform-specific (e.g. Electron) coupling.
 */
export interface LoginDependencies {
	/** Opens the authorization URL and resolves with the full callback URL. */
	authorize: (authorizationUrl: string) => Promise<string>;
	/** Fetch used for OIDC discovery + token exchange. Defaults to global fetch. */
	fetch?: CustomFetch | undefined;
}

/** Tokens returned from a successful OAuth login. */
export interface OAuthTokens {
	access_token: string;
	id_token?: string | undefined;
	token_type: string;
	expires_in?: number | undefined;
	scope?: string | undefined;
	/** The full token endpoint response from openid-client for advanced use cases. */
	raw: client.TokenEndpointResponse;
}

const DEFAULT_SCOPES = ["openid", "email", "profile"];

const WELL_KNOWN_PATH = ".well-known/openid-configuration";

/** Resolves the OIDC discovery document URL, tolerating trailing slashes and
 * an `issuerUrl` that already points directly at the well-known document. */
function wellKnownUrl(issuerUrl: string): string {
	const issuer = new URL(issuerUrl);
	if (issuer.pathname.endsWith(`/${WELL_KNOWN_PATH}`)) return issuer.href;
	// Append (not replace) the well-known path to the issuer's own path so
	// issuers rooted at a sub-path (e.g. `/api/auth`) discover correctly.
	issuer.pathname = `${issuer.pathname.replace(/\/$/, "")}/${WELL_KNOWN_PATH}`;
	return issuer.href;
}

/**
 * Fetches the OpenID Provider metadata from `<issuerUrl>/.well-known/openid-configuration`
 * and builds a {@link client.Configuration} directly from the returned metadata.
 *
 * We deliberately do NOT use `client.discovery()`: it rejects when the metadata
 * `issuer` differs from the discovery URL. Anaconda serves metadata from
 * `https://anaconda.com/...` but reports an `issuer` of
 * `https://auth.anaconda.com/api/auth`, so `discovery()` fails with an
 * issuer-mismatch. Building the `Configuration` from fetched metadata uses the
 * real issuer/endpoints and sidesteps that check (as `anaconda-desktop` does).
 */
async function discoverConfiguration(
	config: OAuthConfig,
	doFetch: CustomFetch,
): Promise<client.Configuration> {
	const issuerUrl = config.issuerUrl ?? `https://${config.domain}`;
	const discoveryUrl = wellKnownUrl(issuerUrl);

	let metadata: ServerMetadata;
	try {
		const response = await doFetch(discoveryUrl, {
			method: "GET",
			headers: {},
			body: undefined,
			redirect: "manual",
		});
		if (!response.ok) {
			throw new Error(`discovery request failed (${response.status} ${response.statusText})`);
		}
		metadata = (await response.json()) as ServerMetadata;
	} catch (error) {
		throw new OAuthDiscoveryError(`Failed OIDC discovery for ${issuerUrl}`, { cause: error });
	}

	const oidcConfig = new client.Configuration(
		metadata,
		config.clientId,
		{ token_endpoint_auth_method: "none" },
		client.None(),
	);
	oidcConfig[client.customFetch] = doFetch;
	if (config.allowInsecureRequests) {
		client.allowInsecureRequests(oidcConfig);
	}
	return oidcConfig;
}

/**
 * Completes the full OAuth 2.0 Authorization Code + PKCE login flow.
 *
 * The platform-specific concerns (opening the browser, receiving the deep-link
 * callback, and the fetch implementation) are injected via {@link LoginDependencies},
 * keeping this flow pure and testable.
 *
 * @example
 * ```ts
 * const tokens = await login(
 *   {
 *     domain: "anaconda.com",
 *     clientId: import.meta.env.VITE_AUTH_CLIENT_ID,
 *     redirectUrl: "http://127.0.0.1:8000/auth/oidc",
 *   },
 *   { authorize },
 * );
 * ```
 */
export async function login(config: OAuthConfig, deps: LoginDependencies): Promise<OAuthTokens> {
	const scopes = config.scopes ?? DEFAULT_SCOPES;
	// openid-client's CustomFetchOptions is structurally a RequestInit except that
	// its `body` includes `undefined`, which `exactOptionalPropertyTypes` rejects for
	// the native fetch `RequestInit`. Native fetch tolerates it at runtime, so narrow
	// the options here rather than leaking a cast to callers.
	const doFetch: CustomFetch = deps.fetch ?? ((url, options) => fetch(url, options as RequestInit));

	const oidcConfig = await discoverConfiguration(config, doFetch);

	const codeVerifier = client.randomPKCECodeVerifier();
	const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
	// Anaconda's authorization endpoint requires `state`; it is echoed back on the
	// callback and verified during the code grant (CSRF protection). Mirrors
	// `anaconda-auth`'s `make_auth_code_request_url`, which always sends `state`.
	const state = client.randomState();

	const authorizationUrl = client.buildAuthorizationUrl(oidcConfig, {
		redirect_uri: config.redirectUrl,
		scope: scopes.join(" "),
		state,
		code_challenge: codeChallenge,
		code_challenge_method: "S256",
	});

	const callbackUrl = await deps.authorize(authorizationUrl.href);
	const url = new URL(callbackUrl);

	const error = url.searchParams.get("error");
	if (error) {
		const description = url.searchParams.get("error_description") ?? undefined;
		throw new OAuthCallbackError(error, description);
	}

	let tokens: client.TokenEndpointResponse;
	try {
		tokens = await client.authorizationCodeGrant(oidcConfig, url, {
			pkceCodeVerifier: codeVerifier,
			expectedState: state,
		});
	} catch (error) {
		throw new OAuthTokenError("Token exchange failed", { cause: error });
	}

	return {
		access_token: tokens.access_token,
		token_type: tokens.token_type ?? "bearer",
		id_token: tokens.id_token,
		expires_in: tokens.expires_in,
		scope: typeof tokens.scope === "string" ? tokens.scope : undefined,
		raw: tokens,
	};
}
