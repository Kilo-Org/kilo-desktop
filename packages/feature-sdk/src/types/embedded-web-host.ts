export const EMBEDDED_WEB_HOST_CAPABILITY = "embeddedWebHost";
export const ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE = "active-untrusted-content";

export type EmbeddedWebHostSecurityProfile = typeof ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE;

export interface EmbeddedWebHostRouteContext {
	/** Resolved protocol origin of the document making this same-origin request. */
	readonly origin: string;
}

/**
 * A third-party web bundle served from a distinct host on the desktop scheme.
 * The shell owns serving and security-policy enforcement; plugins contribute
 * only their bundle root, same-origin data routes, and named security profiles.
 */
export interface EmbeddedWebHost {
	readonly host: string;
	/** Undefined means this build intentionally ships no bundle. */
	readonly root: string | undefined;
	readonly routes?: Readonly<
		Record<string, (context: EmbeddedWebHostRouteContext) => Promise<unknown>>
	>;
	/**
	 * Inline HTML documents served directly by the shell, keyed by absolute
	 * request pathname (e.g. `/widget-host.html`). Use this instead of `root`
	 * for a small static document that does not warrant a filesystem bundle —
	 * the shell owns serving and security-policy enforcement, so the matching
	 * `securityProfiles` entry (if any) still selects the CSP. Consulted before
	 * `root`, so a document cannot be shadowed by a bundled file at that path.
	 */
	readonly documents?: Readonly<Record<string, string>>;
	readonly securityProfiles?: Readonly<Record<string, EmbeddedWebHostSecurityProfile>>;
}
