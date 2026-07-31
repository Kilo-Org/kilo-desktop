import { z } from "zod";

import type { AuthUser } from "@anaconda-agentic-desktop/contracts";

import type { OAuthFetch } from "./types.js";

/** Scopes requested for the exchanged Anaconda API key. */
const API_KEY_SCOPES = ["cloud:read", "cloud:write", "repo:read"] as const;

/** Endpoints tried in order; the second is a fallback for older deployments. */
const API_KEY_PATHS = ["/api/auth/api-keys", "/api/iam/api-keys"] as const;

const apiKeyResponseSchema = z.object({ api_key: z.string() });

/**
 * Exchanges an OAuth access token for a long-lived Anaconda API key.
 *
 * Posts to `/api/auth/api-keys` first, falling back to `/api/iam/api-keys` when
 * the primary endpoint does not return HTTP 201 (or throws). Throws when both
 * endpoints fail or the response lacks an `api_key`; the caller maps this to an
 * `error` session rather than crossing the IPC boundary.
 *
 * @param domain Site domain (e.g. "anaconda.com"); the request targets `https://<domain>`.
 * @param accessToken OAuth access token from the login flow.
 * @param fetchImpl Electron-backed fetch (`electronFetch`) — never global fetch.
 * @param userAgent Tag recorded on the key (e.g. "anaconda-agentic-desktop/1.2.3").
 */
export async function exchangeForApiKey(
	domain: string,
	accessToken: string,
	fetchImpl: OAuthFetch,
	userAgent: string,
): Promise<string> {
	const body = JSON.stringify({ scopes: [...API_KEY_SCOPES], tags: [userAgent] });
	const headers = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
	};

	let lastError: unknown;
	for (const path of API_KEY_PATHS) {
		try {
			const response = await fetchImpl(`https://${domain}${path}`, {
				method: "POST",
				headers,
				body,
			});
			if (response.status !== 201) {
				lastError = new Error(`API key exchange failed (${response.status}) at ${path}`);
				continue;
			}
			return apiKeyResponseSchema.parse(await response.json()).api_key;
		} catch (cause) {
			lastError = cause;
		}
	}

	throw lastError instanceof Error
		? lastError
		: new Error(`API key exchange failed: ${String(lastError)}`);
}

/**
 * Response shape of `GET /api/auth/sessions/whoami`. Mirrors
 * `../ana-cli/src/auth/actions.rs` (`WhoamiResponse`): the passport carries the
 * user id and a profile with optional username/email.
 */
export const whoamiResponseSchema = z.object({
	passport: z.object({
		user_id: z.string().nullish(),
		profile: z
			.object({
				username: z.string().nullish(),
				email: z.string().nullish(),
				first_name: z.string().nullish(),
				last_name: z.string().nullish(),
			})
			.nullish(),
	}),
});

export type WhoamiResponse = z.infer<typeof whoamiResponseSchema>;

/** Map a parsed whoami payload to the contract's `AuthUser` shape. */
export function passportToUser(response: WhoamiResponse): AuthUser {
	const { passport } = response;
	const user: AuthUser = {};
	if (passport.user_id != null) user.userId = passport.user_id;
	if (passport.profile?.username != null) user.username = passport.profile.username;
	if (passport.profile?.email != null) user.email = passport.profile.email;
	if (passport.profile?.first_name != null) user.firstName = passport.profile.first_name;
	if (passport.profile?.last_name != null) user.lastName = passport.profile.last_name;
	return user;
}
