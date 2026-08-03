import { describe, expect, it, afterEach, vi } from "vitest";

import type { AnacondaConfigData } from "./config.js";
import type { ResolvedSite } from "./site.js";

import { DEFAULT_DOMAIN, buildOAuthConfig, resolveSite } from "./site.js";

function loader(config: AnacondaConfigData): () => Promise<AnacondaConfigData> {
	return async () => config;
}

describe("resolveSite", () => {
	it("defaults to anaconda.com with no config", async () => {
		const site = await resolveSite(loader({}));
		expect(site.domain).toBe(DEFAULT_DOMAIN);
	});

	it("resolves default_site by exact key", async () => {
		const site = await resolveSite(
			loader({
				default_site: "prod",
				sites: { prod: { domain: "anaconda.example.com", api_key: "k" } },
			}),
		);
		expect(site.domain).toBe("anaconda.example.com");
		expect(site.api_key).toBe("k");
	});

	it("resolves default_site by domain when not a key", async () => {
		const site = await resolveSite(
			loader({
				default_site: "anaconda.example.com",
				sites: { prod: { domain: "anaconda.example.com" } },
			}),
		);
		expect(site.domain).toBe("anaconda.example.com");
	});

	it("merges plugin.auth with the site (site wins)", async () => {
		const site = await resolveSite(
			loader({
				default_site: "prod",
				plugin: { auth: { domain: "plugin.example.com", api_key: "plugin-key" } },
				sites: { prod: { domain: "site.example.com" } },
			}),
		);
		expect(site.domain).toBe("site.example.com");
		// api_key only set by plugin.auth carries through when site omits it.
		expect(site.api_key).toBe("plugin-key");
	});

	it("throws when default_site matches more than one site by domain", async () => {
		await expect(
			resolveSite(
				loader({
					default_site: "dup.example.com",
					sites: {
						a: { domain: "dup.example.com" },
						b: { domain: "dup.example.com" },
					},
				}),
			),
		).rejects.toThrow(/more than one/);
	});

	it("throws when default_site is an unknown custom site", async () => {
		await expect(
			resolveSite(loader({ default_site: "typo.example.com", sites: {} })),
		).rejects.toThrow(/not configured/);
	});

	it("tolerates default_site of the well-known domain with no matching site", async () => {
		const site = await resolveSite(loader({ default_site: "anaconda.com", sites: {} }));
		expect(site.domain).toBe(DEFAULT_DOMAIN);
	});
});

describe("buildOAuthConfig", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("prefers site.client_id over the env var", () => {
		vi.stubEnv("VITE_AUTH_CLIENT_ID", "env-client");
		const site: ResolvedSite = { domain: "anaconda.test", client_id: "site-client" };

		expect(buildOAuthConfig(site)).toEqual({
			domain: "anaconda.test",
			clientId: "site-client",
			redirectUrl: "http://127.0.0.1:8000/auth/oidc",
		});
	});

	it("falls back to VITE_AUTH_CLIENT_ID when site.client_id is absent", () => {
		vi.stubEnv("VITE_AUTH_CLIENT_ID", "env-client");
		const site: ResolvedSite = { domain: "anaconda.test" };

		expect(buildOAuthConfig(site).clientId).toBe("env-client");
	});

	it("applies the default redirect when redirect_uri is absent", () => {
		vi.stubEnv("VITE_AUTH_CLIENT_ID", "env-client");
		const site: ResolvedSite = { domain: "anaconda.test" };

		expect(buildOAuthConfig(site).redirectUrl).toBe("http://127.0.0.1:8000/auth/oidc");
	});

	it("uses site.redirect_uri when present", () => {
		vi.stubEnv("VITE_AUTH_CLIENT_ID", "env-client");
		const site: ResolvedSite = {
			domain: "anaconda.test",
			redirect_uri: "custom://cb",
		};

		expect(buildOAuthConfig(site).redirectUrl).toBe("custom://cb");
	});

	it("maps auth_domain_override to an issuerUrl", () => {
		vi.stubEnv("VITE_AUTH_CLIENT_ID", "env-client");
		const site: ResolvedSite = {
			domain: "anaconda.test",
			auth_domain_override: "auth-local",
		};

		expect(buildOAuthConfig(site).issuerUrl).toBe("https://auth-local");
	});

	it("yields an empty client ID when no configured source resolves", () => {
		vi.stubEnv("VITE_AUTH_CLIENT_ID", "");
		const site: ResolvedSite = { domain: "anaconda.test" };

		expect(buildOAuthConfig(site).clientId).toBe("");
	});

	it("ignores a blank site override", () => {
		vi.stubEnv("VITE_AUTH_CLIENT_ID", "env-client");
		const site: ResolvedSite = { domain: "anaconda.test", client_id: " " };

		expect(buildOAuthConfig(site).clientId).toBe("env-client");
	});
});
