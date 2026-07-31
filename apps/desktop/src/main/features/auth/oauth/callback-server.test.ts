import { describe, expect, it, vi, beforeEach } from "vitest";

const mockElectron = vi.hoisted(() => ({
	shell: {
		openExternal: vi.fn(async (_url: string) => {}),
	},
	net: {
		fetch: vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok")),
	},
}));

vi.mock("electron", () => ({
	shell: mockElectron.shell,
	net: mockElectron.net,
}));

import { startLoopbackAuthorize, electronFetch } from "./callback-server.js";
import { DEFAULT_REDIRECT_URL } from "../constants.js";

const AUTH_URL = "https://issuer.example/authorize?client_id=abc";

// Inject a no-op logger so the default `createLogger` (electron-log) isn't
// initialized against the mocked `electron` module. Bind an ephemeral port
// (`0`) so tests never depend on the fixed prod port 8000 being free.
const silentLogger = { info() {}, warn() {} };
const DOMAIN = "anaconda.test";
const startAuthorize = (overrides: { timeoutMs?: number; port?: number; domain?: string } = {}) =>
	startLoopbackAuthorize({ logger: silentLogger, port: 0, domain: DOMAIN, ...overrides });

describe("startLoopbackAuthorize", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockElectron.shell.openExternal.mockResolvedValue(undefined);
	});

	it("binds a loopback /auth/oidc redirect URL", async () => {
		const { redirectUrl, close } = await startAuthorize();
		try {
			const parsed = new URL(redirectUrl);
			expect(parsed.hostname).toBe("127.0.0.1");
			expect(parsed.pathname).toBe("/auth/oidc");
			expect(Number(parsed.port)).toBeGreaterThan(0);
		} finally {
			close();
		}
	});

	it("uses the fixed registered port by default (production)", () => {
		expect(DEFAULT_REDIRECT_URL).toBe("http://127.0.0.1:8000/auth/oidc");
	});

	it("opens the browser and resolves with the callback URL when the redirect arrives", async () => {
		const { redirectUrl, authorize } = await startAuthorize();

		mockElectron.shell.openExternal.mockImplementationOnce(async () => {
			// Simulate the browser hitting the loopback redirect with code+state.
			await fetch(`${redirectUrl}?code=xyz&state=abc`, { redirect: "manual" });
		});

		const callbackUrl = await authorize(AUTH_URL);

		expect(mockElectron.shell.openExternal).toHaveBeenCalledWith(AUTH_URL);
		const parsed = new URL(callbackUrl);
		expect(parsed.pathname).toBe("/auth/oidc");
		expect(parsed.searchParams.get("code")).toBe("xyz");
		expect(parsed.searchParams.get("state")).toBe("abc");
	});

	it("redirects the browser to the hosted success page when a code arrives", async () => {
		const { redirectUrl, authorize } = await startAuthorize();

		let pending: Promise<Response> | undefined;
		mockElectron.shell.openExternal.mockImplementationOnce(async () => {
			pending = fetch(`${redirectUrl}?code=xyz&state=abc`, { redirect: "manual" });
		});

		await authorize(AUTH_URL);
		const response = await pending;

		expect(response?.status).toBe(302);
		expect(response?.headers.get("location")).toBe(`https://${DOMAIN}/app/local-login-success`);
	});

	it("redirects the browser to the hosted error page when an error arrives", async () => {
		const { redirectUrl, authorize } = await startAuthorize();

		let pending: Promise<Response> | undefined;
		mockElectron.shell.openExternal.mockImplementationOnce(async () => {
			pending = fetch(`${redirectUrl}?error=access_denied&state=abc`, { redirect: "manual" });
		});

		await authorize(AUTH_URL);
		const response = await pending;

		expect(response?.status).toBe(302);
		expect(response?.headers.get("location")).toBe(`https://${DOMAIN}/app/local-login-error`);
	});

	it("rejects when openExternal fails and frees the port", async () => {
		const first = await startAuthorize();
		mockElectron.shell.openExternal.mockRejectedValueOnce(new Error("No browser"));
		await expect(first.authorize(AUTH_URL)).rejects.toThrow("No browser");

		// The port is freed, so a second authorizer can bind again.
		const second = await startAuthorize();
		expect(new URL(second.redirectUrl).pathname).toBe("/auth/oidc");
		second.close();
	});

	it("rejects when the callback never arrives (timeout) and frees the port", async () => {
		const { authorize } = await startAuthorize({ timeoutMs: 20 });
		await expect(authorize(AUTH_URL)).rejects.toThrow(/Timed out waiting for OAuth callback/);

		// Port freed → can rebind.
		const again = await startAuthorize({ timeoutMs: 20 });
		await expect(again.authorize(AUTH_URL)).rejects.toThrow(/Timed out/);
	});

	it("rejects with a clear message when the port is already in use", async () => {
		const holder = await startAuthorize();
		const port = Number(new URL(holder.redirectUrl).port);
		try {
			await expect(startAuthorize({ port })).rejects.toThrow(new RegExp(`port ${port} is in use`));
		} finally {
			holder.close();
		}
	});
});

describe("electronFetch", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("delegates to net.fetch with the given url and options", async () => {
		const init: RequestInit = { method: "POST", body: "grant" };
		await electronFetch("https://issuer.example/token", init);

		expect(mockElectron.net.fetch).toHaveBeenCalledWith("https://issuer.example/token", init);
	});
});
