/**
 * Path fragment for the Anaconda Remote MCP endpoint, appended to the resolved
 * site domain when no override is configured.
 */
export const MCP_PATH = "/api/mcp";

export type AnacondaMcpUrlResolution =
	| { readonly ok: true; readonly url: string }
	| { readonly ok: false; readonly reason: string };

function normalizeHost(host: string): string {
	return host.trim().toLowerCase().replace(/\.$/, "");
}

/**
 * Resolve the Remote MCP URL, pinned to the signed-in Anaconda site domain.
 *
 * The Anaconda API key is attached as a `Bearer` to requests to this URL, so the
 * URL alone decides where that credential goes. It is therefore derived from the
 * resolved site domain — the same `auth.session.getSiteDomain()` anchor the auth
 * flow (`https://${site.domain}/api/auth/…`) and the model-catalog client
 * (`https://${domain}/api/ai/model/models`) use — and never trusted from
 * arbitrary user input:
 *
 * - no override → `https://<siteDomain>/api/mcp`
 * - override → must be an absolute `https:` URL with no embedded credentials
 *   whose host exactly equals the site domain. Anything else is rejected so the
 *   caller can fail closed (no MCP entry, no contributed key), which also closes
 *   the "impostor MCP server" (spoofing) case.
 */
export function resolveAnacondaMcpUrl(
	override: string | null | undefined,
	siteDomain: string,
): AnacondaMcpUrlResolution {
	const site = normalizeHost(siteDomain);
	const candidate = override?.trim() ? override.trim() : `https://${site}${MCP_PATH}`;

	let url: URL;
	try {
		url = new URL(candidate);
	} catch {
		return { ok: false, reason: "URL is not a valid absolute URL" };
	}

	if (url.protocol !== "https:") {
		return { ok: false, reason: "URL must use https" };
	}
	if (url.username || url.password) {
		return { ok: false, reason: "URL must not embed credentials" };
	}
	if (normalizeHost(url.host) !== site) {
		return { ok: false, reason: `URL host must match the Anaconda site domain (${siteDomain})` };
	}

	return { ok: true, url: url.href };
}
