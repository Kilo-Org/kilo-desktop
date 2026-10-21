import { describe, expect, it, vi } from "vitest";

import {
	AnacondaAccountService,
	type AnacondaAccountServiceOptions,
	type AnacondaCredentials,
	type ApiKeyExchanger,
	type OAuthLogin,
} from "./AnacondaAccountService.js";
import { OAuthCancelledError } from "./oauth/errors.js";
import type { OAuthFetch } from "./oauth/types.js";

const silentLogger = { info() {}, warn() {}, error() {} };

const whoamiBody = {
	passport: { user_id: "u1", profile: { username: "ada", email: "ada@example.com" } },
};
const SIGNED_IN = {
	status: "authenticated",
	user: { userId: "u1", username: "ada", email: "ada@example.com" },
} as const;

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/** Stateful fake of the shell `auth` capability slice (keyring + site). */
function fakeCredentials(
	initialKey: string | null = null,
	overrides: Partial<AnacondaCredentials> = {},
) {
	let apiKey = initialKey;
	const credentials = {
		getApiKey: vi.fn(async () => apiKey),
		getOAuthSettings: vi.fn(async () => ({
			domain: "anaconda.test",
			clientId: "client",
			userAgent: "kilo-desktop/1.2.3",
		})),
		saveApiKey: vi.fn(async (key: string) => {
			apiKey = key;
		}),
		deleteApiKey: vi.fn(async () => {
			apiKey = null;
		}),
		...overrides,
	};
	return {
		credentials,
		setKey: (key: string | null) => {
			apiKey = key;
		},
	};
}

const tokens = { access_token: "access-token", token_type: "bearer", raw: {} as never };

function makeService(
	options: Partial<AnacondaAccountServiceOptions> & {
		credentials?: () => AnacondaCredentials | null;
	} = {},
) {
	return new AnacondaAccountService({
		credentials: () => fakeCredentials().credentials,
		fetch: vi.fn<OAuthFetch>(async () => jsonResponse(whoamiBody)),
		openExternal: async () => true,
		logger: silentLogger,
		login: vi.fn<OAuthLogin>(async () => tokens),
		createAuthorizeServer: async () => ({
			redirectUrl: "http://127.0.0.1:8000/auth/oidc",
			authorize: async () => "http://127.0.0.1:8000/auth/oidc?code=c",
			close() {},
			reopen: async () => true,
			cancel() {},
		}),
		exchangeForApiKey: vi.fn<ApiKeyExchanger>(async () => "new-key"),
		...options,
	});
}

describe("AnacondaAccountService session", () => {
	it("is anonymous when no key is stored", async () => {
		const { credentials } = fakeCredentials(null);
		const fetch = vi.fn<OAuthFetch>();
		const service = makeService({ credentials: () => credentials, fetch });

		await expect(service.getSession()).resolves.toEqual({ status: "anonymous" });
		expect(fetch).not.toHaveBeenCalled();
	});

	it("is authenticated from whoami when a key is stored", async () => {
		const { credentials } = fakeCredentials("api-key");
		const fetch = vi.fn<OAuthFetch>(async () => jsonResponse(whoamiBody));
		const service = makeService({ credentials: () => credentials, fetch });

		await expect(service.getSession()).resolves.toEqual(SIGNED_IN);
		expect(fetch).toHaveBeenCalledWith(
			"https://anaconda.test/api/auth/sessions/whoami",
			expect.objectContaining({ headers: { Authorization: "Bearer api-key" } }),
		);
	});

	it.each([401, 403])("treats a rejected key (%i) as anonymous", async (status) => {
		const { credentials } = fakeCredentials("bad-key");
		const service = makeService({
			credentials: () => credentials,
			fetch: async () => new Response("no", { status }),
		});

		await expect(service.getSession()).resolves.toEqual({ status: "anonymous" });
	});

	it("reports an error for network, server and payload failures", async () => {
		const { credentials } = fakeCredentials("api-key");
		const offline = makeService({
			credentials: () => credentials,
			fetch: async () => Promise.reject(new Error("offline")),
		});
		const serverError = makeService({
			credentials: () => credentials,
			fetch: async () => new Response("boom", { status: 500 }),
		});
		const badPayload = makeService({
			credentials: () => credentials,
			fetch: async () => jsonResponse({}),
		});

		await expect(offline.getSession()).resolves.toEqual({ status: "error", reason: "offline" });
		await expect(serverError.getSession()).resolves.toEqual({
			status: "error",
			reason: "whoami request failed (500)",
		});
		await expect(badPayload.getSession()).resolves.toMatchObject({ status: "error" });
	});

	it("reports an error when the site config cannot be resolved", async () => {
		const { credentials } = fakeCredentials("api-key", {
			getOAuthSettings: async () => Promise.reject(new Error("bad config.toml")),
		});
		const service = makeService({ credentials: () => credentials });

		await expect(service.getSession()).resolves.toEqual({
			status: "error",
			reason: "bad config.toml",
		});
	});

	it("reports sign-in unavailable when the shell auth capability is missing", async () => {
		const service = makeService({ credentials: () => null });

		await expect(service.getSession()).resolves.toEqual({
			status: "error",
			reason: "Anaconda sign-in is unavailable.",
		});
		await expect(service.login()).resolves.toMatchObject({ status: "error" });
		await expect(service.logout()).resolves.toMatchObject({ status: "error" });
	});

	it("caches the session until refresh and shares concurrent resolves", async () => {
		const { credentials } = fakeCredentials("api-key");
		const fetch = vi.fn<OAuthFetch>(async () => jsonResponse(whoamiBody));
		const service = makeService({ credentials: () => credentials, fetch });

		await Promise.all([service.getSession(), service.getSession()]);
		await service.getSession();
		expect(fetch).toHaveBeenCalledTimes(1);

		await service.refresh();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("notifies on session transitions and on silent key rotation, not on no-ops", async () => {
		const { credentials, setKey } = fakeCredentials("key-1");
		const service = makeService({ credentials: () => credentials });
		const listener = vi.fn();
		service.onChanged(listener);

		await service.getSession();
		expect(listener).toHaveBeenCalledTimes(1);

		await service.refresh();
		expect(listener).toHaveBeenCalledTimes(1);

		setKey("key-2");
		await service.refresh();
		expect(listener).toHaveBeenCalledTimes(2);

		service.dispose();
		setKey("key-3");
		await service.refresh();
		expect(listener).toHaveBeenCalledTimes(2);
	});
});

describe("AnacondaAccountService login", () => {
	it("runs OAuth → exchange → save, then resolves authenticated", async () => {
		const { credentials } = fakeCredentials(null);
		const login = vi.fn<OAuthLogin>(async () => tokens);
		const exchange = vi.fn<ApiKeyExchanger>(async () => "new-key");
		const service = makeService({
			credentials: () => credentials,
			login,
			exchangeForApiKey: exchange,
		});
		const listener = vi.fn();
		service.onChanged(listener);

		await expect(service.login()).resolves.toEqual(SIGNED_IN);

		expect(login).toHaveBeenCalledWith(
			{
				domain: "anaconda.test",
				clientId: "client",
				redirectUrl: "http://127.0.0.1:8000/auth/oidc",
			},
			expect.objectContaining({ authorize: expect.any(Function) }),
		);
		expect(exchange).toHaveBeenCalledWith(
			"anaconda.test",
			"access-token",
			expect.any(Function),
			"kilo-desktop/1.2.3",
		);
		expect(credentials.saveApiKey).toHaveBeenCalledWith("new-key");
		expect(listener).toHaveBeenCalledWith(SIGNED_IN);
	});

	it("passes an issuer override through to the OAuth flow", async () => {
		const { credentials } = fakeCredentials(null, {
			getOAuthSettings: async () => ({
				domain: "anaconda.test",
				clientId: "client",
				issuerUrl: "https://auth.anaconda.test",
			}),
		});
		const login = vi.fn<OAuthLogin>(async () => tokens);
		const service = makeService({ credentials: () => credentials, login });

		await service.login();

		expect(login.mock.calls[0]?.[0]).toMatchObject({ issuerUrl: "https://auth.anaconda.test" });
	});

	it("fails without a client id and never opens the browser", async () => {
		const { credentials } = fakeCredentials(null, {
			getOAuthSettings: async () => ({ domain: "anaconda.test", clientId: "" }),
		});
		const createAuthorizeServer = vi.fn();
		const service = makeService({ credentials: () => credentials, createAuthorizeServer });

		await expect(service.login()).resolves.toMatchObject({ status: "error" });
		expect(createAuthorizeServer).not.toHaveBeenCalled();
	});

	it("fails when the browser cannot be opened outside Electron", async () => {
		const service = new AnacondaAccountService({
			credentials: () => fakeCredentials().credentials,
			fetch: vi.fn<OAuthFetch>(),
			openExternal: undefined,
			logger: silentLogger,
		});

		await expect(service.login()).resolves.toEqual({
			status: "error",
			reason: "Anaconda sign-in is unavailable.",
		});
	});

	it("returns the failure reason and stores nothing when a step fails", async () => {
		const { credentials } = fakeCredentials(null);
		const authorizeFails = makeService({
			credentials: () => credentials,
			login: async () => Promise.reject(new Error("Timed out waiting for OAuth callback")),
		});
		const exchangeFails = makeService({
			credentials: () => credentials,
			exchangeForApiKey: async () => Promise.reject(new Error("API key exchange failed (500)")),
		});

		await expect(authorizeFails.login()).resolves.toEqual({
			status: "error",
			reason: "Timed out waiting for OAuth callback",
		});
		await expect(exchangeFails.login()).resolves.toEqual({
			status: "error",
			reason: "API key exchange failed (500)",
		});
		expect(credentials.saveApiKey).not.toHaveBeenCalled();
	});

	it("frees the callback port when the OAuth flow fails before opening the browser", async () => {
		const close = vi.fn();
		const service = makeService({
			createAuthorizeServer: async () => ({
				redirectUrl: "http://127.0.0.1:8000/auth/oidc",
				authorize: async () => "http://127.0.0.1:8000/auth/oidc?code=c",
				close,
				reopen: async () => true,
				cancel() {},
			}),
			// Discovery fails before `authorize` (which would close the server) runs.
			login: async () => Promise.reject(new Error("Failed OIDC discovery")),
		});

		await expect(service.login()).resolves.toMatchObject({ status: "error" });
		expect(close).toHaveBeenCalled();
	});

	it("shares one sign-in between concurrent callers", async () => {
		const { credentials } = fakeCredentials(null);
		let finishAuthorize: (url: string) => void = () => {};
		const createAuthorizeServer = vi.fn(async () => ({
			redirectUrl: "http://127.0.0.1:8000/auth/oidc",
			authorize: () =>
				new Promise<string>((resolve) => {
					finishAuthorize = resolve;
				}),
			close() {},
			reopen: async () => true,
			cancel() {},
		}));
		const login = vi.fn<OAuthLogin>(async (_config, deps) => {
			await deps.authorize("https://issuer/authorize");
			return tokens;
		});
		const service = makeService({ credentials: () => credentials, createAuthorizeServer, login });

		const first = service.login();
		const second = service.login();
		await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(1));
		finishAuthorize("http://127.0.0.1:8000/auth/oidc?code=c");

		await expect(first).resolves.toEqual(SIGNED_IN);
		await expect(second).resolves.toEqual(SIGNED_IN);
		expect(createAuthorizeServer).toHaveBeenCalledTimes(1);

		// A later sign-in starts a fresh flow.
		const third = service.login();
		await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(2));
		finishAuthorize("http://127.0.0.1:8000/auth/oidc?code=d");
		await expect(third).resolves.toEqual(SIGNED_IN);
	});

	/** An authorizer whose browser step waits until the test approves or cancels it. */
	function pendingAuthorizer() {
		let approve: (url: string) => void = () => {};
		let rejectWait: (cause: Error) => void = () => {};
		let cancelled = false;
		// Mirrors the real loopback server: a cancel before `authorize` makes it
		// reject immediately.
		const authorizer = {
			redirectUrl: "http://127.0.0.1:8000/auth/oidc",
			authorize: () =>
				cancelled
					? Promise.reject(new OAuthCancelledError())
					: new Promise<string>((resolve, reject) => {
							approve = resolve;
							rejectWait = reject;
						}),
			close: vi.fn(),
			reopen: vi.fn(async () => true),
			cancel: vi.fn(() => {
				cancelled = true;
				rejectWait(new OAuthCancelledError());
			}),
		};
		const login = vi.fn<OAuthLogin>(async (_config, deps) => {
			await deps.authorize("https://issuer/authorize?state=s");
			return tokens;
		});
		return { authorizer, login, approve: (url: string) => approve(url) };
	}

	it("reopens the browser when sign-in is requested again while one is pending", async () => {
		const { credentials } = fakeCredentials(null);
		const { authorizer, login, approve } = pendingAuthorizer();
		const service = makeService({
			credentials: () => credentials,
			createAuthorizeServer: async () => authorizer,
			login,
		});

		const first = service.login();
		await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(1));
		const second = service.login();

		expect(authorizer.reopen).toHaveBeenCalledTimes(1);
		approve("http://127.0.0.1:8000/auth/oidc?code=c&state=s");
		await expect(first).resolves.toEqual(SIGNED_IN);
		await expect(second).resolves.toEqual(SIGNED_IN);
		expect(login).toHaveBeenCalledTimes(1);
	});

	it("cancelling a pending sign-in ends it quietly with the current session", async () => {
		const { credentials } = fakeCredentials(null);
		const { authorizer, login } = pendingAuthorizer();
		const service = makeService({
			credentials: () => credentials,
			createAuthorizeServer: async () => authorizer,
			login,
		});

		const pending = service.login();
		await vi.waitFor(() => expect(login).toHaveBeenCalledTimes(1));
		service.cancelLogin();

		await expect(pending).resolves.toEqual({ status: "anonymous" });
		expect(authorizer.cancel).toHaveBeenCalledTimes(1);
		expect(credentials.saveApiKey).not.toHaveBeenCalled();
	});

	it("cancelling before the callback server starts still cancels the sign-in", async () => {
		const { credentials } = fakeCredentials(null);
		const { authorizer, login } = pendingAuthorizer();
		let releaseSettings: () => void = () => {};
		vi.mocked(credentials.getOAuthSettings).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					releaseSettings = () =>
						resolve({
							domain: "anaconda.test",
							clientId: "client",
							userAgent: "kilo-desktop/1.2.3",
						});
				}),
		);
		const service = makeService({
			credentials: () => credentials,
			createAuthorizeServer: async () => authorizer,
			login,
		});

		const pending = service.login();
		service.cancelLogin();
		releaseSettings();

		await expect(pending).resolves.toEqual({ status: "anonymous" });
		expect(authorizer.cancel).toHaveBeenCalledTimes(1);
	});

	it("cancelling with no sign-in pending does nothing", () => {
		const service = makeService();

		expect(() => service.cancelLogin()).not.toThrow();
	});

	it("returns the keyring error when the key cannot be saved", async () => {
		const { credentials } = fakeCredentials(null, {
			saveApiKey: async () => Promise.reject(new Error("The Anaconda keyring is read-only.")),
		});
		const service = makeService({ credentials: () => credentials });

		await expect(service.login()).resolves.toEqual({
			status: "error",
			reason: "The Anaconda keyring is read-only.",
		});
	});
});

describe("AnacondaAccountService logout", () => {
	it("deletes the key and publishes anonymous", async () => {
		const { credentials } = fakeCredentials("api-key");
		const service = makeService({ credentials: () => credentials });
		await service.getSession();
		const listener = vi.fn();
		service.onChanged(listener);

		await expect(service.logout()).resolves.toEqual({ status: "anonymous" });

		expect(credentials.deleteApiKey).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({ status: "anonymous" });
		await expect(service.getSession()).resolves.toEqual({ status: "anonymous" });
	});

	it("returns the keyring error and keeps the session when deletion fails", async () => {
		const { credentials } = fakeCredentials("api-key", {
			deleteApiKey: async () => Promise.reject(new Error("The Anaconda keyring is read-only.")),
		});
		const service = makeService({ credentials: () => credentials });
		await service.getSession();

		await expect(service.logout()).resolves.toEqual({
			status: "error",
			reason: "The Anaconda keyring is read-only.",
		});
		await expect(service.getSession()).resolves.toEqual(SIGNED_IN);
	});
});
