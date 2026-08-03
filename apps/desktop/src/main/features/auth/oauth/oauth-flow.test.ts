import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { OAuthDiscoveryError, OAuthCallbackError } from "../errors.js";
import { login } from "./oauth-flow.js";

/**
 * Minimal mock OIDC server for integration testing.
 */
const createMockOIDCServer = (options: { issuer?: (port: number) => string } = {}) => {
	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");

		if (url.pathname === "/.well-known/openid-configuration") {
			const address = server.address();
			const port = typeof address === "object" && address ? address.port : 0;
			// The issuer defaults to the discovery origin but can be overridden to
			// simulate a provider (like Anaconda) that serves its metadata from one
			// host while reporting a different `issuer` — the case that broke prod.
			const issuer = options.issuer?.(port) ?? `http://127.0.0.1:${port}`;
			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					issuer,
					authorization_endpoint: `http://127.0.0.1:${port}/authorize`,
					token_endpoint: `http://127.0.0.1:${port}/token`,
					response_types_supported: ["code"],
					code_challenge_methods_supported: ["S256"],
				}),
			);
			return;
		}

		if (url.pathname === "/token" && req.method === "POST") {
			let body = "";
			req.on("data", (chunk: Buffer) => {
				body += chunk.toString();
			});
			req.on("end", () => {
				const params = new URLSearchParams(body);
				if (params.get("grant_type") !== "authorization_code") {
					res.writeHead(400, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "unsupported_grant_type" }));
					return;
				}
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						access_token: "mock-access-token",
						token_type: "Bearer",
						expires_in: 3600,
						scope: "openid email profile",
					}),
				);
			});
			return;
		}

		res.writeHead(404);
		res.end();
	});

	const start = () =>
		new Promise<number>((resolve, reject) => {
			server.on("error", reject);
			server.listen(0, "127.0.0.1", () => {
				const address = server.address();
				if (typeof address === "object" && address) {
					resolve(address.port);
				}
			});
		});

	const stop = () =>
		new Promise<void>((resolve, reject) => {
			server.close((err) => (err ? reject(err) : resolve()));
		});

	return { start, stop };
};

describe("login", () => {
	let mockServer: ReturnType<typeof createMockOIDCServer>;
	let port: number;

	const config = () => ({
		domain: "localhost",
		clientId: "test-client",
		redirectUrl: "test-app://oauth/callback",
		issuerUrl: `http://127.0.0.1:${port}`,
		allowInsecureRequests: true,
	});

	/**
	 * Builds an `authorize` stub that resolves with a callback URL. By default it
	 * echoes back the `state` param from the received authorization URL (as a real
	 * provider does) so the code grant's `expectedState` check passes. Pass an
	 * explicit `callbackUrl` to override (e.g. to simulate an error callback).
	 */
	const stubAuthorize = (callbackUrl?: string) =>
		vi.fn(async (authorizationUrl: string) => {
			if (callbackUrl !== undefined) return callbackUrl;
			const state = new URL(authorizationUrl).searchParams.get("state") ?? "";
			return `test-app://oauth/callback?code=test-auth-code&state=${encodeURIComponent(state)}`;
		});

	beforeEach(async () => {
		vi.clearAllMocks();
		mockServer = createMockOIDCServer();
		port = await mockServer.start();
	});

	afterEach(async () => {
		await mockServer.stop();
	});

	it("completes the full login flow and returns tokens", async () => {
		const tokens = await login(config(), { authorize: stubAuthorize() });
		expect(tokens.access_token).toBe("mock-access-token");
		expect(tokens.token_type).toBe("bearer");
		expect(tokens.expires_in).toBe(3600);
	});

	it("builds authorization URL with correct PKCE parameters", async () => {
		const authorize = stubAuthorize();
		await login(config(), { authorize });

		const received = authorize.mock.calls[0]?.[0];
		expect(received).toBeDefined();
		const url = new URL(received!);
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("code_challenge")).toBeTruthy();
		expect(url.searchParams.get("redirect_uri")).toBe("test-app://oauth/callback");
		expect(url.searchParams.get("scope")).toBe("openid email profile");
		expect(url.searchParams.get("client_id")).toBe("test-client");
		expect(url.searchParams.get("state")).toBeTruthy();
	});

	it("throws OAuthCallbackError when the callback contains an error", async () => {
		const authorize = stubAuthorize(
			"test-app://oauth/callback?error=access_denied&error_description=User+cancelled",
		);
		await expect(login(config(), { authorize })).rejects.toThrow(OAuthCallbackError);
	});

	it("throws OAuthDiscoveryError when discovery fails", async () => {
		await expect(
			login({ ...config(), issuerUrl: "http://127.0.0.1:1" }, { authorize: stubAuthorize() }),
		).rejects.toThrow(OAuthDiscoveryError);
	});

	it("succeeds when the metadata issuer differs from the discovery URL", async () => {
		// Regression: Anaconda serves metadata at anaconda.com but reports an
		// issuer of auth.anaconda.com/api/auth. openid-client's `discovery()`
		// rejects that mismatch; building the Configuration from fetched metadata
		// must not. Restart the server with a mismatched issuer.
		await mockServer.stop();
		mockServer = createMockOIDCServer({ issuer: () => "https://auth.example.com/api/auth" });
		port = await mockServer.start();

		const tokens = await login(config(), { authorize: stubAuthorize() });
		expect(tokens.access_token).toBe("mock-access-token");
	});

	it("discovers when the issuer URL already points at the well-known document", async () => {
		const issuerUrl = `http://127.0.0.1:${port}/.well-known/openid-configuration`;
		const tokens = await login({ ...config(), issuerUrl }, { authorize: stubAuthorize() });
		expect(tokens.access_token).toBe("mock-access-token");
	});

	it("discovers when the issuer URL has a trailing slash", async () => {
		const issuerUrl = `http://127.0.0.1:${port}/`;
		const tokens = await login({ ...config(), issuerUrl }, { authorize: stubAuthorize() });
		expect(tokens.access_token).toBe("mock-access-token");
	});

	it("propagates the error when authorize rejects", async () => {
		const authorize = vi.fn(async () => {
			throw new Error("No browser");
		});
		await expect(login(config(), { authorize })).rejects.toThrow("No browser");
	});
});
