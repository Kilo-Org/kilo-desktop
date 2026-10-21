import { describe, expect, it, vi } from "vitest";

import { AnacondaCredentialStore } from "./anaconda-credential-store.js";
import type { TokenPayload } from "./types.js";

describe("AnacondaCredentialStore", () => {
	function keyringFake(writable = true, initial: Partial<TokenPayload> | null = null) {
		let token: Partial<TokenPayload> | null = initial;
		const keyring = {
			writable,
			getToken: async () =>
				token ? ({ domain: "anaconda.test", ...token } as TokenPayload) : null,
			getApiKey: async () => token?.api_key ?? null,
			saveToken: vi.fn(async (next: Partial<TokenPayload>) => {
				token = next;
			}),
			deleteToken: vi.fn(async () => {
				token = null;
			}),
		};
		return keyring;
	}

	function serviceWith(
		keyring: ReturnType<typeof keyringFake>,
		site: Record<string, unknown> = {},
	): AnacondaCredentialStore {
		return new AnacondaCredentialStore({
			resolveSite: async () => ({ domain: "anaconda.test", ...site }),
			loadKeyring: async () => keyring,
		});
	}

	it("stores and deletes the API key that getApiKey reads", async () => {
		const service = serviceWith(keyringFake());

		await service.saveApiKey("ak-1");
		await expect(service.getApiKey()).resolves.toBe("ak-1");

		await service.deleteApiKey();
		await expect(service.getApiKey()).resolves.toBeNull();
	});

	it("keeps the rest of a shared keyring entry when saving a new key", async () => {
		const repoTokens = [{ token: "repo-token", org_name: "acme" }];
		const keyring = keyringFake(true, {
			api_key: "expired",
			username: "old-user",
			user_id: "old-id",
			repo_tokens: repoTokens,
			version: 2,
		});
		const service = serviceWith(keyring);

		await service.saveApiKey("ak-new");

		expect(keyring.saveToken).toHaveBeenCalledWith({
			domain: "anaconda.test",
			api_key: "ak-new",
			repo_tokens: repoTokens,
			version: 2,
		});
	});

	it("removes only the key and its identity on delete, keeping repo tokens", async () => {
		const repoTokens = [{ token: "repo-token", org_name: "acme" }];
		const keyring = keyringFake(true, {
			api_key: "ak-1",
			username: "ada",
			user_id: "u1",
			repo_tokens: repoTokens,
			version: 2,
		});
		const service = serviceWith(keyring);

		await service.deleteApiKey();

		expect(keyring.deleteToken).not.toHaveBeenCalled();
		expect(keyring.saveToken).toHaveBeenCalledWith({
			domain: "anaconda.test",
			api_key: null,
			repo_tokens: repoTokens,
			version: 2,
		});
		await expect(service.getApiKey()).resolves.toBeNull();
	});

	it("deletes the whole entry when nothing but the key would remain", async () => {
		const keyring = keyringFake(true, { api_key: "ak-1", username: "ada", repo_tokens: [] });
		const service = serviceWith(keyring);

		await service.deleteApiKey();

		expect(keyring.deleteToken).toHaveBeenCalledTimes(1);
		expect(keyring.saveToken).not.toHaveBeenCalled();
	});

	it("saves a fresh entry when none exists or it cannot be read", async () => {
		const keyring = keyringFake();
		keyring.getToken = async () => Promise.reject(new Error("locked"));
		const service = serviceWith(keyring);

		await service.saveApiKey("ak-new");

		expect(keyring.saveToken).toHaveBeenCalledWith({ api_key: "ak-new" });
	});

	it("rejects writes to a read-only keyring without touching it", async () => {
		const keyring = keyringFake(false);
		const service = serviceWith(keyring);

		await expect(service.saveApiKey("ak-1")).rejects.toThrow("read-only");
		await expect(service.deleteApiKey()).rejects.toThrow("read-only");
		expect(keyring.saveToken).not.toHaveBeenCalled();
		expect(keyring.deleteToken).not.toHaveBeenCalled();
	});

	it("maps the site config to OAuth settings", async () => {
		const service = serviceWith(keyringFake(), {
			client_id: " site-client ",
			auth_domain_override: "auth.anaconda.test",
		});

		await expect(service.getOAuthSettings()).resolves.toEqual({
			domain: "anaconda.test",
			clientId: "site-client",
			issuerUrl: "https://auth.anaconda.test",
			userAgent: "kilo-desktop",
		});
	});

	it("tags created keys with the configured app user agent", async () => {
		const service = new AnacondaCredentialStore({
			resolveSite: async () => ({ domain: "anaconda.test", client_id: "c" }),
			userAgent: "kilo-desktop/1.2.3",
		});

		await expect(service.getOAuthSettings()).resolves.toMatchObject({
			userAgent: "kilo-desktop/1.2.3",
		});
	});

	it("falls back to the build-time client id when the site has none", async () => {
		vi.stubEnv("VITE_AUTH_CLIENT_ID", "build-client");
		try {
			const service = serviceWith(keyringFake());
			await expect(service.getOAuthSettings()).resolves.toEqual({
				domain: "anaconda.test",
				clientId: "build-client",
				userAgent: "kilo-desktop",
			});
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("degrades reads instead of throwing when the config or keyring is unavailable", async () => {
		const broken = new AnacondaCredentialStore({
			resolveSite: async () => Promise.reject(new Error("bad config.toml")),
			logger: { warn() {} },
		});

		await expect(broken.getApiKey()).resolves.toBeNull();
		await expect(broken.getSiteDomain()).resolves.toBe("anaconda.com");
		await expect(broken.getOAuthSettings()).rejects.toThrow("bad config.toml");
	});
});
