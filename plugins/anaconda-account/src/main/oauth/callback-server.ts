import { createServer, type Server } from "node:http";
import pDefer from "p-defer";

import {
	REDIRECT_URI_HOST,
	REDIRECT_URI_PATH,
	REDIRECT_URI_PORT,
	AUTHORIZE_TIMEOUT_MS,
} from "./constants.js";
import { OAuthCancelledError } from "./errors.js";
import type { Authorize, LoopbackAuthorizer, OAuthLogger } from "./types.js";

/** Options for {@link startLoopbackAuthorize}. */
export interface LoopbackAuthorizeOptions {
	/**
	 * Opens the authorization URL in the system browser (the shell's
	 * `mainSdk.host.externalLinks.open`). Resolves `false` when nothing opened.
	 */
	openExternal: (url: string) => Promise<boolean>;
	logger: Pick<OAuthLogger, "info" | "warn">;
	/** Site domain used to build the hosted success/error redirect URLs. */
	domain?: string;
	timeoutMs?: number;
	/**
	 * Port to bind. Defaults to the fixed, registered {@link REDIRECT_URI_PORT}.
	 * Overridable only so tests can bind an ephemeral port (`0`); production must
	 * use the registered port or the authorization server rejects the redirect.
	 */
	port?: number;
}

/** Hosted pages the browser is redirected to after the callback (per `anaconda-auth`). */
function loginResultUrls(domain: string): { success: string; error: string } {
	return {
		success: `https://${domain}/app/local-login-success`,
		error: `https://${domain}/app/local-login-error`,
	};
}

/**
 * Starts a loopback HTTP server on the fixed, registered port to receive the
 * OAuth callback. Returns the bound `redirectUrl` (so the caller builds the
 * authorization URL with the matching, registered `redirect_uri`) and an
 * `authorize` function that opens the browser and resolves with the full
 * callback URL.
 *
 * The port is fixed (not auto-selected): the OAuth client only allowlists
 * `http://127.0.0.1:8000/auth/oidc`, so any other port would be rejected as an
 * invalid redirect_uri. On `EADDRINUSE` it rejects with a clear error rather
 * than silently picking an unregistered port.
 *
 * On callback the server issues a `302` to the hosted success page (when a
 * `code` is present) or error page (when an `error` is present), then closes.
 */
export async function startLoopbackAuthorize(
	options: LoopbackAuthorizeOptions,
): Promise<LoopbackAuthorizer> {
	const { logger, openExternal } = options;
	const timeoutMs = options.timeoutMs ?? AUTHORIZE_TIMEOUT_MS;
	const requestedPort = options.port ?? REDIRECT_URI_PORT;
	const resultUrls = loginResultUrls(options.domain ?? "");

	const deferred = pDefer<string>();
	// A cancel before `authorize` runs rejects with no one awaiting yet; mark it
	// handled here so it isn't reported as an unhandled rejection.
	deferred.promise.catch(() => undefined);
	// The pending authorization URL and its `state`; null until `authorize` runs.
	let pendingAuthorizationUrl: string | null = null;
	let expectedState: string | null = null;
	let cancelled = false;

	const server = createServer((req, res) => {
		const requestUrl = new URL(req.url ?? "/", `http://${REDIRECT_URI_HOST}`);
		// Only the authorization response for the pending request (`code` or
		// `error`, echoing its `state`) settles the flow. The port is fixed and
		// reachable by any local process or web page, so anything else — a bare
		// hit, a forged code, a stale state — must not end a pending sign-in.
		const { searchParams } = requestUrl;
		const isAuthorizationResponse = searchParams.has("code") || searchParams.has("error");
		const matchesPendingRequest =
			expectedState !== null && searchParams.get("state") === expectedState;
		if (
			requestUrl.pathname !== REDIRECT_URI_PATH ||
			!isAuthorizationResponse ||
			!matchesPendingRequest
		) {
			res.writeHead(404).end();
			return;
		}
		// Redirect the browser to a hosted result page; success vs error is
		// distinguished by the `code` vs `error` query param (matches upstream).
		const location = searchParams.has("error") ? resultUrls.error : resultUrls.success;
		res.writeHead(302, { Location: location }).end();
		// Resolve with the absolute callback URL so the caller can read `code`,
		// `state`, and any `error` params from it (openid-client parses them).
		deferred.resolve(`http://${REDIRECT_URI_HOST}:${boundPort}${req.url ?? ""}`);
	});

	const boundPort = await listen(server, requestedPort);
	const redirectUrl = `http://${REDIRECT_URI_HOST}:${boundPort}${REDIRECT_URI_PATH}`;

	const authorize: Authorize = (authorizationUrl) => {
		// Cancelled while discovery ran: don't open a browser for a dead sign-in.
		if (cancelled) return Promise.reject(new OAuthCancelledError());
		pendingAuthorizationUrl = authorizationUrl;
		expectedState = new URL(authorizationUrl).searchParams.get("state");
		const timer = setTimeout(() => {
			deferred.reject(new Error(`Timed out waiting for OAuth callback at "${redirectUrl}"`));
		}, timeoutMs);

		logger.info(`awaiting OAuth callback at "${redirectUrl}"; opening browser…`);
		openExternal(authorizationUrl).then(
			(opened) => {
				if (!opened) deferred.reject(new Error("Could not open the browser to sign in."));
			},
			(cause: unknown) => {
				deferred.reject(cause instanceof Error ? cause : new Error(String(cause)));
			},
		);

		return deferred.promise.finally(() => {
			clearTimeout(timer);
			server.close();
		});
	};

	const reopen = async (): Promise<boolean> => {
		if (pendingAuthorizationUrl === null) return false;
		return openExternal(pendingAuthorizationUrl).catch(() => false);
	};

	const cancel = (): void => {
		cancelled = true;
		pendingAuthorizationUrl = null;
		deferred.reject(new OAuthCancelledError());
		server.close();
	};

	return { redirectUrl, authorize, close: () => server.close(), reopen, cancel };
}

/** Binds the loopback port, rejecting with a clear message if it is busy. */
function listen(server: Server, port: number): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const onError = (cause: NodeJS.ErrnoException) => {
			server.off("listening", onListening);
			reject(
				cause.code === "EADDRINUSE"
					? new Error(
							`OAuth callback port ${port} is in use. Close whatever is using it and try again.`,
						)
					: cause,
			);
		};
		const onListening = () => {
			server.off("error", onError);
			const address = server.address();
			resolve(typeof address === "object" && address ? address.port : port);
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(port, REDIRECT_URI_HOST);
	});
}
