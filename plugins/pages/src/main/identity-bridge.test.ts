import { afterEach, describe, expect, it } from "vitest";

import {
	createAgentToken,
	startIdentityBridge,
	type IdentityBridge,
	type IdentityBridgeOptions,
} from "./identity-bridge";

const AUDIENCE = "pages-desktop";
const KEY = "a".repeat(64);
const PAGES_ORIGIN = "http://localhost:9899";
const USER = { id: "local-user", name: "Ada" };

const bridges: IdentityBridge[] = [];

async function start(options: Partial<IdentityBridgeOptions> = {}) {
	const bridge = await startIdentityBridge({
		audience: AUDIENCE,
		signingKey: KEY,
		pagesOrigin: () => PAGES_ORIGIN,
		user: USER,
		...options,
	});
	bridges.push(bridge);
	return bridge;
}

afterEach(async () => {
	await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
});

async function signIn(bridge: IdentityBridge, state = "state-1") {
	const response = await fetch(
		`${bridge.url}/pages-auth?${new URLSearchParams({ audience: AUDIENCE, state })}`,
		{ redirect: "manual" },
	);
	const location = new URL(response.headers.get("location") ?? "");
	return { response, location, code: location.searchParams.get("code") ?? "" };
}

function exchange(bridge: IdentityBridge, body: unknown, secret = bridge.exchangeSecret) {
	return fetch(`${bridge.url}/api/pages-auth/exchange`, {
		method: "POST",
		headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("identity bridge", () => {
	it("listens on loopback with a fresh exchange secret each run", async () => {
		const first = await start();
		const second = await start();

		expect(new URL(first.url).hostname).toBe("127.0.0.1");
		expect(first.exchangeSecret.length).toBeGreaterThanOrEqual(32);
		expect(first.exchangeSecret).not.toBe(second.exchangeSecret);
	});

	it("approves a browser sign-in at once, back to Pages' callback with the state", async () => {
		const bridge = await start();

		const { response, location, code } = await signIn(bridge, "xyz");

		expect(response.status).toBe(302);
		expect(`${location.origin}${location.pathname}`).toBe(`${PAGES_ORIGIN}/api/auth/kilo/callback`);
		expect(location.searchParams.get("state")).toBe("xyz");
		expect(code.length).toBeGreaterThanOrEqual(24);
	});

	it("refuses a sign-in for another audience or without a state", async () => {
		const bridge = await start();

		const other = await fetch(`${bridge.url}/pages-auth?audience=other&state=s`, {
			redirect: "manual",
		});
		const stateless = await fetch(`${bridge.url}/pages-auth?audience=${AUDIENCE}`, {
			redirect: "manual",
		});

		expect(other.status).toBe(400);
		expect(stateless.status).toBe(400);
	});

	it("exchanges a sign-in code once, for the local user", async () => {
		const bridge = await start();
		const { code } = await signIn(bridge, "s1");

		const first = await exchange(bridge, { code, audience: AUDIENCE, state: "s1" });
		const again = await exchange(bridge, { code, audience: AUDIENCE, state: "s1" });

		expect(first.status).toBe(200);
		await expect(first.json()).resolves.toEqual({ user: USER, organizations: [] });
		expect(again.status).toBe(400);
		await expect(again.json()).resolves.toEqual({ error: "invalid_token" });
	});

	it("refuses a code given with another state", async () => {
		const bridge = await start();
		const { code } = await signIn(bridge, "s1");

		const response = await exchange(bridge, { code, audience: AUDIENCE, state: "s2" });

		expect(response.status).toBe(400);
	});

	it("refuses an expired code", async () => {
		let now = 1_000_000;
		const bridge = await start({ now: () => now });
		const { code } = await signIn(bridge);
		now += 10 * 60_000;

		const response = await exchange(bridge, { code, audience: AUDIENCE, state: "state-1" });

		expect(response.status).toBe(400);
	});

	it("exchanges the agent tokens it signed", async () => {
		const bridge = await start();
		const token = createAgentToken({ audience: AUDIENCE, signingKey: KEY, userId: USER.id });

		const response = await exchange(bridge, { token, audience: AUDIENCE });

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ user: USER, organizations: [] });
	});

	it("refuses tokens signed with another key, for another audience, expired or garbled", async () => {
		const bridge = await start();
		const now = Math.floor(Date.now() / 1000);
		const tokens = [
			createAgentToken({ audience: AUDIENCE, signingKey: "b".repeat(64), userId: USER.id }),
			createAgentToken({ audience: "other", signingKey: KEY, userId: USER.id }),
			createAgentToken({
				audience: AUDIENCE,
				signingKey: KEY,
				userId: USER.id,
				issuedAt: now - 1000,
				lifetimeSeconds: 10,
			}),
			"not-a-token",
			"a.b.c",
		];

		const statuses = await Promise.all(
			tokens.map(async (token) => (await exchange(bridge, { token, audience: AUDIENCE })).status),
		);

		expect(statuses).toEqual([400, 400, 400, 400, 400]);
	});

	it("refuses a wrong exchange secret or audience as an unknown client", async () => {
		const bridge = await start();
		const token = createAgentToken({ audience: AUDIENCE, signingKey: KEY, userId: USER.id });

		const badSecret = await exchange(bridge, { token, audience: AUDIENCE }, "x".repeat(48));
		const badAudience = await exchange(bridge, { token, audience: "other" });

		expect(badSecret.status).toBe(401);
		await expect(badSecret.json()).resolves.toEqual({ error: "invalid_client" });
		expect(badAudience.status).toBe(401);
	});

	it("answers a malformed exchange with invalid_token and anything else with 404", async () => {
		const bridge = await start();

		const malformed = await fetch(`${bridge.url}/api/pages-auth/exchange`, {
			method: "POST",
			headers: { authorization: `Bearer ${bridge.exchangeSecret}` },
			body: "{not json",
		});
		const neither = await exchange(bridge, { audience: AUDIENCE });
		const unknown = await fetch(`${bridge.url}/elsewhere`);

		expect(malformed.status).toBe(400);
		expect(neither.status).toBe(400);
		expect(unknown.status).toBe(404);
	});
});

describe("createAgentToken", () => {
	it("is a delegated-workload JWT for the audience, stable for the same issue time", () => {
		const options = { audience: AUDIENCE, signingKey: KEY, userId: USER.id, issuedAt: 100 };

		const token = createAgentToken(options);
		const [header, payload] = token.split(".");

		expect(createAgentToken(options)).toBe(token);
		expect(JSON.parse(Buffer.from(header!, "base64url").toString())).toEqual({
			alg: "HS256",
			typ: "JWT",
		});
		expect(JSON.parse(Buffer.from(payload!, "base64url").toString())).toMatchObject({
			version: 1,
			kiloUserId: USER.id,
			aud: AUDIENCE,
			iat: 100,
			tokenPurpose: "delegated-workload",
			credentialExchange: false,
		});
	});
});
