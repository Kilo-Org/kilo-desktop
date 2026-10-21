import { describe, expect, it, vi } from "vitest";

import type { OAuthFetch } from "./oauth/types.js";
import { exchangeForApiKey, passportToUser, whoamiResponseSchema } from "./actions.js";

const DOMAIN = "anaconda.test";
const TOKEN = "access-token";
const USER_AGENT = "kilo-desktop/1.2.3";

function jsonResponse(body: unknown, status: number): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("exchangeForApiKey", () => {
	it("returns the key from the primary endpoint on 201", async () => {
		const fetch = vi.fn<OAuthFetch>(async () => jsonResponse({ api_key: "key-1" }, 201));

		const key = await exchangeForApiKey(DOMAIN, TOKEN, fetch, USER_AGENT);

		expect(key).toBe("key-1");
		expect(fetch).toHaveBeenCalledTimes(1);
		expect(fetch).toHaveBeenCalledWith(
			`https://${DOMAIN}/api/auth/api-keys`,
			expect.objectContaining({
				method: "POST",
				headers: {
					Authorization: `Bearer ${TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					scopes: ["cloud:read", "cloud:write", "repo:read"],
					tags: [USER_AGENT],
				}),
			}),
		);
	});

	it("falls back to the iam endpoint when the primary is not 201", async () => {
		const fetch = vi
			.fn<OAuthFetch>()
			.mockResolvedValueOnce(jsonResponse({ detail: "not found" }, 404))
			.mockResolvedValueOnce(jsonResponse({ api_key: "key-2" }, 201));

		const key = await exchangeForApiKey(DOMAIN, TOKEN, fetch, USER_AGENT);

		expect(key).toBe("key-2");
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(fetch).toHaveBeenLastCalledWith(
			`https://${DOMAIN}/api/iam/api-keys`,
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("falls back when the primary endpoint throws", async () => {
		const fetch = vi
			.fn<OAuthFetch>()
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce(jsonResponse({ api_key: "key-3" }, 201));

		await expect(exchangeForApiKey(DOMAIN, TOKEN, fetch, USER_AGENT)).resolves.toBe("key-3");
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("throws when both endpoints fail", async () => {
		const fetch = vi.fn<OAuthFetch>(async () => jsonResponse({ detail: "nope" }, 500));

		await expect(exchangeForApiKey(DOMAIN, TOKEN, fetch, USER_AGENT)).rejects.toThrow(
			"API key exchange failed (500) at /api/iam/api-keys",
		);
		expect(fetch).toHaveBeenCalledTimes(2);
	});

	it("throws when the response is missing api_key", async () => {
		const fetch = vi.fn<OAuthFetch>(async () => jsonResponse({ wrong: "shape" }, 201));

		await expect(exchangeForApiKey(DOMAIN, TOKEN, fetch, USER_AGENT)).rejects.toThrow();
	});

	it("stringifies a non-Error failure from the fallback endpoint", async () => {
		const fetch = vi.fn<OAuthFetch>().mockRejectedValue("offline");

		await expect(exchangeForApiKey(DOMAIN, TOKEN, fetch, USER_AGENT)).rejects.toThrow(
			"API key exchange failed: offline",
		);
	});
});

describe("passport", () => {
	it("parses a full whoami payload and maps it to a user", () => {
		const payload = whoamiResponseSchema.parse({
			passport: {
				user_id: "user-123",
				profile: {
					username: "ada",
					email: "ada@example.com",
					first_name: "Ada",
					last_name: "Lovelace",
				},
			},
		});

		expect(passportToUser(payload)).toEqual({
			userId: "user-123",
			username: "ada",
			email: "ada@example.com",
			firstName: "Ada",
			lastName: "Lovelace",
		});
	});

	it("omits absent name fields when the profile lacks them", () => {
		const payload = whoamiResponseSchema.parse({
			passport: {
				user_id: "user-123",
				profile: { username: "ada", email: "ada@example.com" },
			},
		});

		const user = passportToUser(payload);
		expect(user).toEqual({
			userId: "user-123",
			username: "ada",
			email: "ada@example.com",
		});
		expect("firstName" in user).toBe(false);
		expect("lastName" in user).toBe(false);
	});

	it("omits absent optional fields (service account without profile)", () => {
		const payload = whoamiResponseSchema.parse({
			passport: { user_id: "svc-1", profile: null },
		});

		expect(passportToUser(payload)).toEqual({ userId: "svc-1" });
	});

	it("omits userId when the passport does not provide one", () => {
		const payload = whoamiResponseSchema.parse({
			passport: { user_id: null, profile: null },
		});

		expect(passportToUser(payload)).toEqual({});
	});

	it("rejects a payload missing the passport", () => {
		expect(whoamiResponseSchema.safeParse({}).success).toBe(false);
	});
});
