import { AnacondaConfig, type AnacondaAuthSite, type AnacondaConfigData } from "./config.js";
import { DEFAULT_REDIRECT_URL } from "../constants.js";
import type { OAuthConfig } from "../types.js";

export const DEFAULT_DOMAIN = "anaconda.com";

/** A resolved site config guaranteed to carry a concrete domain. */
export type ResolvedSite = AnacondaAuthSite & { domain: string };

/** Loader seam so the resolver is unit-testable without touching the filesystem. */
export type ConfigLoader = () => Promise<AnacondaConfigData>;

const defaultLoader: ConfigLoader = async () => (await AnacondaConfig.load()).store;

/**
 * Returns `host` (hostname + port if present), mirroring Python's
 * urlparse(...).netloc so two sites distinguished only by port compare
 * distinctly. Falls back to the raw value when it is not a parseable URL.
 */
function domainify(value: string): string {
	try {
		return new URL(value.includes("://") ? value : `https://${value}`).host;
	} catch {
		return value;
	}
}

/**
 * Looks up a site whose normalized domain equals `domain`. Mirrors
 * `findSiteConfigByDomain` in `../anaconda-desktop/src/main/auth/auth-config.ts`.
 * Throws on multi-match; returns null on zero-match.
 */
function findSiteConfigByDomain(
	sites: Record<string, AnacondaAuthSite>,
	domain: string,
): AnacondaAuthSite | null {
	const target = domainify(domain);
	const matches = Object.entries(sites).filter(
		([, site]) => site.domain && target === domainify(site.domain),
	);

	if (matches.length < 2) {
		return matches[0]?.[1] ?? null;
	}

	const keys = matches.map(([key]) => key).join(", ");
	throw new Error(`domain ${target} matches more than one configured site (${keys})`);
}

/**
 * Picks the `[sites.<name>]` entry that overlays `[plugin.auth]`. Mirrors
 * `resolveSiteConfig`: look up `default_site` as an exact key first, then as a
 * domain. If it resolves to nothing and is not the well-known default domain,
 * throw (catches config typos).
 */
function resolveSiteConfig(config: AnacondaConfigData): AnacondaAuthSite | null {
	const sites = config.sites ?? {};
	const defaultSite = config.default_site;

	if (!defaultSite) return null;

	const match = sites[defaultSite] ?? findSiteConfigByDomain(sites, defaultSite);
	if (match) return match;

	if (domainify(defaultSite) !== DEFAULT_DOMAIN) {
		throw new Error(`default_site "${defaultSite}" is not configured`);
	}

	return null;
}

/**
 * Resolve the active Anaconda site: merge `plugin.auth` with the resolved site
 * config (site wins) and guarantee a concrete `domain` (defaults to
 * `anaconda.com`). No Electron dependency — safe to unit test.
 */
export async function resolveSite(loader: ConfigLoader = defaultLoader): Promise<ResolvedSite> {
	const config = await loader();
	const pluginAuth = config.plugin?.auth ?? {};
	const siteConfig = resolveSiteConfig(config) ?? {};

	const merged: AnacondaAuthSite = { ...pluginAuth, ...siteConfig };
	return { ...merged, domain: merged.domain ?? DEFAULT_DOMAIN };
}

/**
 * Builds the OAuth config for a resolved site. The client id comes from the
 * site config, then the environment-specific value injected by Vite. A missing
 * value is rejected by the Vite build and guarded again by the auth service.
 */
export function buildOAuthConfig(site: ResolvedSite): OAuthConfig {
	return {
		domain: site.domain,
		clientId: site.client_id?.trim() || import.meta.env.VITE_AUTH_CLIENT_ID?.trim() || "",
		redirectUrl: site.redirect_uri ?? DEFAULT_REDIRECT_URL,
		...(site.auth_domain_override ? { issuerUrl: `https://${site.auth_domain_override}` } : {}),
	};
}
