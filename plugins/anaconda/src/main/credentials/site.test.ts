import { describe, expect, it } from "vitest";

import type { AnacondaConfigData } from "./config";

import { DEFAULT_DOMAIN, resolveSite } from "./site";

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
