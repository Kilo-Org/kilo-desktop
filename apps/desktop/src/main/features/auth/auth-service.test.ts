import { describe, expect, it, vi } from "vitest";

import type { OAuthFetch } from "./types.js";
import type { ResolvedSite } from "./config/site.js";
import { AuthSessionService, type UserPassportFetcher } from "./auth-service.js";
import { FREE_SUBSCRIPTION, SUBSCRIPTION_TIERS } from "./utils.js";

const site: ResolvedSite = { domain: "anaconda.test", client_id: "test-client" };

function fakeKeyring(
	apiKey: string | null,
	overrides: {
		writable?: boolean;
		saveToken?: (token: { api_key: string }) => Promise<void>;
		deleteToken?: () => Promise<void>;
	} = {},
) {
	const saveToken = overrides.saveToken ?? (async () => {});
	const deleteToken = overrides.deleteToken ?? (async () => {});
	return async () => ({
		getApiKey: async () => apiKey,
		saveToken,
		deleteToken,
		writable: overrides.writable ?? true,
	});
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

const whoamiBody = {
	passport: { user_id: "u1", profile: { username: "ada", email: "ada@example.com" } },
};

/** Silences the scoped logger so expected failures don't spam test output. */
const silentLogger = { info() {}, warn() {}, error() {} };

describe("AuthSessionService", () => {
	it("can be constructed with its production defaults", () => {
		expect(new AuthSessionService()).toBeInstanceOf(AuthSessionService);
	});

	it("returns anonymous when there is no api key", async () => {
		const service = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: fakeKeyring(null),
			fetch: vi.fn(),
		});

		expect(await service.getSession()).toEqual({ status: "anonymous" });
	});

	it("returns authenticated on a valid key", async () => {
		const fetch = vi.fn<OAuthFetch>(async () => jsonResponse(whoamiBody));
		const service = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: fakeKeyring("api-key"),
			fetch,
		});

		expect(await service.getSession()).toEqual({
			status: "authenticated",
			user: { userId: "u1", username: "ada", email: "ada@example.com" },
		});
		expect(fetch).toHaveBeenCalledWith(
			"https://anaconda.test/api/auth/sessions/whoami",
			expect.objectContaining({
				headers: { Authorization: "Bearer api-key" },
			}),
		);
	});

	it("returns anonymous on 401", async () => {
		const service = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: fakeKeyring("bad-key"),
			fetch: async () => new Response("no", { status: 401 }),
		});

		expect(await service.getSession()).toEqual({ status: "anonymous" });
	});

	it("returns error on network failure", async () => {
		const service = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: fakeKeyring("api-key"),
			fetch: async () => {
				throw new Error("offline");
			},
		});

		const result = await service.getSession();
		expect(result).toEqual({ status: "error", reason: "offline" });
	});

	it("returns error on 5xx", async () => {
		const service = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: fakeKeyring("api-key"),
			fetch: async () => new Response("boom", { status: 503 }),
		});

		expect(await service.getSession()).toEqual({
			status: "error",
			reason: "whoami request failed (503)",
		});
	});

	it("returns error when site resolution throws", async () => {
		const service = new AuthSessionService({
			resolveSite: async () => {
				throw new Error("bad config");
			},
			loadKeyring: fakeKeyring("api-key"),
			fetch: vi.fn(),
		});

		expect(await service.getSession()).toEqual({ status: "error", reason: "bad config" });
	});

	it("stringifies non-Error failures during session resolution", async () => {
		const service = new AuthSessionService({
			resolveSite: async () => {
				throw "bad config";
			},
			loadKeyring: fakeKeyring("api-key"),
			fetch: vi.fn(),
		});

		expect(await service.getSession()).toEqual({ status: "error", reason: "bad config" });
	});

	it("caches the result and only re-resolves on refresh", async () => {
		const fetch = vi.fn<OAuthFetch>(async () => jsonResponse(whoamiBody));
		const service = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: fakeKeyring("api-key"),
			fetch,
		});

		await service.getSession();
		await service.getSession();
		expect(fetch).toHaveBeenCalledTimes(1);

		await service.refresh();
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("emits a change on transition and peeks the cached value", async () => {
		const service = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: fakeKeyring("api-key"),
			fetch: async () => jsonResponse(whoamiBody),
		});

		const listener = vi.fn();
		service.onChanged(listener);
		expect(service.peek()).toEqual({ status: "anonymous" });

		await service.getSession();
		expect(listener).toHaveBeenCalledTimes(1);
		expect(listener).toHaveBeenCalledWith({
			status: "authenticated",
			user: { userId: "u1", username: "ada", email: "ada@example.com" },
		});
		expect(service.peek()).toEqual({
			status: "authenticated",
			user: { userId: "u1", username: "ada", email: "ada@example.com" },
		});
	});

	it("degrades to anonymous when the keyring throws", async () => {
		const service = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: async () => {
				throw new Error("keyring locked");
			},
			fetch: vi.fn(),
		});

		expect(await service.getSession()).toEqual({ status: "anonymous" });
	});

	it("treats a name-only change as a new session and fires onChanged", async () => {
		const firstBody = {
			passport: {
				user_id: "u1",
				profile: {
					username: "ada",
					email: "ada@example.com",
					first_name: "Ada",
					last_name: "Lovelace",
				},
			},
		};
		const renamedBody = {
			passport: {
				user_id: "u1",
				profile: {
					username: "ada",
					email: "ada@example.com",
					first_name: "Augusta",
					last_name: "Lovelace",
				},
			},
		};
		const fetch = vi
			.fn<OAuthFetch>()
			.mockResolvedValueOnce(jsonResponse(firstBody))
			.mockResolvedValueOnce(jsonResponse(renamedBody));
		const service = new AuthSessionService({
			resolveSite: async () => site,
			loadKeyring: fakeKeyring("api-key"),
			fetch,
		});

		const listener = vi.fn();
		service.onChanged(listener);

		await service.getSession();
		expect(listener).toHaveBeenCalledTimes(1);

		await service.refresh();
		expect(listener).toHaveBeenCalledTimes(2);
		expect(listener).toHaveBeenLastCalledWith({
			status: "authenticated",
			user: {
				userId: "u1",
				username: "ada",
				email: "ada@example.com",
				firstName: "Augusta",
				lastName: "Lovelace",
			},
		});
	});

	describe("login", () => {
		function makeTokens() {
			return {
				access_token: "access-token",
				token_type: "bearer",
				raw: {} as never,
			};
		}

		it("runs oauth → exchange → saveToken → refresh and returns authenticated", async () => {
			// Stateful keyring: after saveToken, refresh() re-reads the new key.
			let storedKey: string | null = null;
			const saveToken = vi.fn(async (token: { api_key: string }) => {
				storedKey = token.api_key;
			});
			const loadKeyring = async () => ({
				getApiKey: async () => storedKey,
				saveToken,
				deleteToken: async () => {
					storedKey = null;
				},
				writable: true,
			});
			const login = vi.fn(async () => makeTokens());
			const exchangeForApiKey = vi.fn(async () => "new-api-key");
			const createAuthorizeServer = vi.fn(async () => ({
				redirectUrl: "http://127.0.0.1:8000/auth/oidc",
				authorize: async () => "cb://ok",
				close: () => {},
			}));
			const fetch = vi.fn<OAuthFetch>(async () => jsonResponse(whoamiBody));

			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring,
				fetch,
				login,
				exchangeForApiKey,
				createAuthorizeServer,
				userAgent: "anaconda-agentic-desktop/test",
				logger: silentLogger,
			});

			const result = await service.login();

			expect(result).toEqual({
				status: "authenticated",
				user: { userId: "u1", username: "ada", email: "ada@example.com" },
			});
			expect(login).toHaveBeenCalledTimes(1);
			expect(exchangeForApiKey).toHaveBeenCalledWith(
				"anaconda.test",
				"access-token",
				fetch,
				"anaconda-agentic-desktop/test",
			);
			expect(saveToken).toHaveBeenCalledTimes(1);
			expect(saveToken).toHaveBeenCalledWith({ api_key: "new-api-key" });
		});

		it("returns error and does not save when the keyring is read-only", async () => {
			const saveToken = vi.fn(async () => {});
			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: fakeKeyring(null, { writable: false, saveToken }),
				fetch: vi.fn(),
				login: async () => makeTokens(),
				exchangeForApiKey: async () => "new-api-key",
				createAuthorizeServer: async () => ({
					redirectUrl: "http://127.0.0.1:8000/auth/oidc",
					authorize: async () => "cb://ok",
					close: () => {},
				}),
				logger: silentLogger,
			});

			expect(await service.login()).toEqual({
				status: "error",
				reason: "Keyring is read-only; cannot persist API key.",
			});
			expect(saveToken).not.toHaveBeenCalled();
		});

		it("returns error when authorize rejects", async () => {
			const saveToken = vi.fn(async () => {});
			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: fakeKeyring(null, { saveToken }),
				fetch: vi.fn(),
				login: async () => {
					throw new Error("user cancelled");
				},
				exchangeForApiKey: async () => "new-api-key",
				createAuthorizeServer: async () => ({
					redirectUrl: "http://127.0.0.1:8000/auth/oidc",
					authorize: async () => "cb://ok",
					close: () => {},
				}),
				logger: silentLogger,
			});

			expect(await service.login()).toEqual({ status: "error", reason: "user cancelled" });
			expect(saveToken).not.toHaveBeenCalled();
		});

		it("returns error and does not save when the exchange fails", async () => {
			const saveToken = vi.fn(async () => {});
			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: fakeKeyring(null, { saveToken }),
				fetch: vi.fn(),
				login: async () => makeTokens(),
				exchangeForApiKey: async () => {
					throw new Error("exchange failed");
				},
				createAuthorizeServer: async () => ({
					redirectUrl: "http://127.0.0.1:8000/auth/oidc",
					authorize: async () => "cb://ok",
					close: () => {},
				}),
				logger: silentLogger,
			});

			expect(await service.login()).toEqual({ status: "error", reason: "exchange failed" });
			expect(saveToken).not.toHaveBeenCalled();
		});

		it("returns error when no client id resolves", async () => {
			const service = new AuthSessionService({
				resolveSite: async () => ({ domain: "anaconda.test" }),
				loadKeyring: fakeKeyring(null),
				fetch: vi.fn(),
				login: vi.fn(),
				exchangeForApiKey: vi.fn(),
				createAuthorizeServer: async () => ({
					redirectUrl: "http://127.0.0.1:8000/auth/oidc",
					authorize: async () => "cb://ok",
					close: () => {},
				}),
				logger: silentLogger,
			});

			const result = await service.login();
			expect(result.status).toBe("error");
		});
	});

	describe("logout", () => {
		it("deletes the API key and publishes an anonymous session", async () => {
			let storedKey: string | null = "api-key";
			const deleteToken = vi.fn(async () => {
				storedKey = null;
			});
			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: async () => ({
					getApiKey: async () => storedKey,
					saveToken: async () => {},
					deleteToken,
					writable: true,
				}),
				fetch: async () => jsonResponse(whoamiBody),
				logger: silentLogger,
			});
			const listener = vi.fn();
			service.onChanged(listener);
			await service.getSession();

			expect(await service.logout()).toEqual({ status: "anonymous" });
			expect(deleteToken).toHaveBeenCalledTimes(1);
			expect(listener).toHaveBeenLastCalledWith({ status: "anonymous" });
			expect(await service.getSession()).toEqual({ status: "anonymous" });
		});

		it("returns an error without deleting from a read-only keyring", async () => {
			const deleteToken = vi.fn(async () => {});
			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: fakeKeyring("api-key", { writable: false, deleteToken }),
				logger: silentLogger,
			});

			expect(await service.logout()).toEqual({
				status: "error",
				reason: "Keyring is read-only; cannot delete API key.",
			});
			expect(deleteToken).not.toHaveBeenCalled();
		});
	});

	describe("userinfo caching", () => {
		const businessAttributes = [{ id: "business_subscription.org-1", group: "subscriptions" }];
		const businessOrganizations = [{ id: "org-1", name: "Acme", role: "admin" }];
		const businessPassport = {
			user_id: "u1",
			attributes: businessAttributes,
			organizations: businessOrganizations,
		};

		function serviceWith(getUserPassport: UserPassportFetcher) {
			return new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: fakeKeyring("api-key"),
				fetch: vi.fn(),
				getUserPassport,
				logger: silentLogger,
			});
		}

		it("does not cache a failure and retries on the next call", async () => {
			const getUserPassport = vi
				.fn<UserPassportFetcher>()
				.mockRejectedValueOnce(new Error("offline"))
				.mockResolvedValueOnce(businessPassport);
			const service = serviceWith(getUserPassport);

			await expect(service.getUserInfo()).rejects.toThrow("offline");
			await expect(service.getUserInfo()).resolves.toEqual(businessAttributes);
			expect(getUserPassport).toHaveBeenCalledTimes(2);
		});

		it("caches a successful result", async () => {
			const getUserPassport = vi.fn<UserPassportFetcher>(async () => businessPassport);
			const service = serviceWith(getUserPassport);

			await expect(service.getUserInfo()).resolves.toEqual(businessAttributes);
			await expect(service.getUserInfo()).resolves.toEqual(businessAttributes);
			expect(getUserPassport).toHaveBeenCalledTimes(1);
		});

		it("shares the passport cache across getUserInfo, getOrganizations, and getSubscription", async () => {
			const getUserPassport = vi.fn<UserPassportFetcher>(async () => businessPassport);
			const service = serviceWith(getUserPassport);

			await expect(service.getUserInfo()).resolves.toEqual(businessAttributes);
			await expect(service.getOrganizations()).resolves.toEqual(businessOrganizations);
			await expect(service.getSubscription()).resolves.toBe(SUBSCRIPTION_TIERS.business);
			expect(getUserPassport).toHaveBeenCalledTimes(1);
		});

		it("returns an empty organization list when the passport has none", async () => {
			const getUserPassport = vi.fn<UserPassportFetcher>(async () => ({ user_id: "u1" }));
			const service = serviceWith(getUserPassport);

			await expect(service.getOrganizations()).resolves.toEqual([]);
		});

		it("does not stick free-tier after a transient getSubscription failure", async () => {
			const getUserPassport = vi
				.fn<UserPassportFetcher>()
				.mockRejectedValueOnce(new Error("offline"))
				.mockResolvedValueOnce(businessPassport);
			const service = serviceWith(getUserPassport);

			const first = await service.getSubscription().catch(() => FREE_SUBSCRIPTION);
			expect(first).toBe(FREE_SUBSCRIPTION);

			await expect(service.getSubscription()).resolves.toBe(SUBSCRIPTION_TIERS.business);
			expect(getUserPassport).toHaveBeenCalledTimes(2);
		});

		it("re-resolves userinfo after a session change clears the cache", async () => {
			const getUserPassport = vi.fn<UserPassportFetcher>(async () => businessPassport);
			const renamedBody = {
				passport: {
					user_id: "u1",
					profile: { username: "ada", email: "ada@example.com", first_name: "Augusta" },
				},
			};
			const fetch = vi
				.fn<OAuthFetch>()
				.mockResolvedValueOnce(jsonResponse(whoamiBody))
				.mockResolvedValueOnce(jsonResponse(renamedBody));
			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: fakeKeyring("api-key"),
				fetch,
				getUserPassport,
				logger: silentLogger,
			});

			await service.getSession();
			await service.getUserInfo();
			await service.refresh();
			await service.getUserInfo();

			expect(getUserPassport).toHaveBeenCalledTimes(2);
		});
	});

	describe("getApiKey", () => {
		it("returns the API key when authenticated", async () => {
			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: fakeKeyring("my-secret-key"),
				fetch: async () => jsonResponse(whoamiBody),
			});

			expect(await service.getApiKey()).toBe("my-secret-key");
		});

		it("returns null when no key is stored", async () => {
			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: fakeKeyring(null),
				fetch: vi.fn(),
			});

			expect(await service.getApiKey()).toBeNull();
		});

		it("returns null when the keyring throws", async () => {
			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: async () => {
					throw new Error("keyring locked");
				},
				fetch: vi.fn(),
			});

			expect(await service.getApiKey()).toBeNull();
		});

		it("returns null when site resolution fails", async () => {
			const service = new AuthSessionService({
				resolveSite: async () => {
					throw new Error("bad config");
				},
				loadKeyring: fakeKeyring("api-key"),
				fetch: vi.fn(),
			});

			expect(await service.getApiKey()).toBeNull();
		});
	});

	describe("key rotation detection", () => {
		it("fires onChanged when the API key rotates but session identity is unchanged", async () => {
			let currentKey = "key-v1";
			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: async () => ({
					getApiKey: async () => currentKey,
					saveToken: async () => {},
					deleteToken: async () => {},
					writable: true,
				}),
				fetch: async () => jsonResponse(whoamiBody),
			});

			const listener = vi.fn();
			service.onChanged(listener);

			// First resolution: anonymous → authenticated (fires)
			await service.getSession();
			expect(listener).toHaveBeenCalledTimes(1);

			// Rotate the key (same user identity)
			currentKey = "key-v2";
			await service.refresh();
			// Should fire again because the underlying key changed
			expect(listener).toHaveBeenCalledTimes(2);
		});

		it("does not fire onChanged when refresh returns the same key", async () => {
			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: fakeKeyring("stable-key"),
				fetch: async () => jsonResponse(whoamiBody),
			});

			const listener = vi.fn();
			service.onChanged(listener);

			await service.getSession();
			expect(listener).toHaveBeenCalledTimes(1);

			// Refresh with same key → no change
			await service.refresh();
			expect(listener).toHaveBeenCalledTimes(1);
		});

		it("fires onChanged when key goes from present to null (logout)", async () => {
			let currentKey: string | null = "api-key";
			const service = new AuthSessionService({
				resolveSite: async () => site,
				loadKeyring: async () => ({
					getApiKey: async () => currentKey,
					saveToken: async () => {},
					deleteToken: async () => {
						currentKey = null;
					},
					writable: true,
				}),
				fetch: async () => jsonResponse(whoamiBody),
				logger: silentLogger,
			});

			const listener = vi.fn();
			service.onChanged(listener);

			await service.getSession();
			expect(listener).toHaveBeenCalledTimes(1);

			await service.logout();
			// Session changed (authenticated → anonymous) AND key changed
			expect(listener).toHaveBeenCalledTimes(2);
		});
	});
});
