import { describe, expect, it, vi, beforeEach } from "vitest";
import type * as NodeHttp from "node:http";

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

// Real servers are used everywhere except where a test opts into a synthetic
// bind error. `listenError.code` is consumed once by the next `server.listen`
// so we can drive the non-EADDRINUSE branch without relying on the OS refusing
// a privileged port (which isn't portable across the CI matrix — see
// ScopedFsService.mocked.test.ts for the same errno-mocking convention).
const httpControl = vi.hoisted(() => ({ listenError: undefined as string | undefined }));

vi.mock("node:http", async (importOriginal) => {
	const actual = await importOriginal<typeof NodeHttp>();
	return {
		...actual,
		createServer: (...args: Parameters<typeof actual.createServer>) => {
			const server = actual.createServer(...args);
			const originalListen = server.listen.bind(server);
			server.listen = ((...listenArgs: unknown[]) => {
				const code = httpControl.listenError;
				if (code !== undefined) {
					httpControl.listenError = undefined;
					queueMicrotask(() => {
						const error = new Error(`listen ${code}`) as NodeJS.ErrnoException;
						error.code = code;
						server.emit("error", error);
					});
					return server;
				}
				return originalListen(...(listenArgs as Parameters<typeof server.listen>));
			}) as typeof server.listen;
			return server;
		},
	};
});

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

	it("responds 404 for a request to a non-callback path", async () => {
		const { redirectUrl, close } = await startAuthorize();
		try {
			const origin = new URL(redirectUrl).origin;
			const response = await fetch(`${origin}/not-the-callback`, { redirect: "manual" });
			expect(response.status).toBe(404);
		} finally {
			close();
		}
	});

	it("rejects with a wrapped Error when openExternal rejects with a non-Error", async () => {
		const { authorize } = await startAuthorize();
		mockElectron.shell.openExternal.mockRejectedValueOnce("browser exploded");

		await expect(authorize(AUTH_URL)).rejects.toThrow("browser exploded");
	});

	it("rejects with the original error when binding fails for a non-EADDRINUSE reason", async () => {
		// A synthetic EACCES on listen exercises the branch that rethrows the
		// original cause rather than the port-in-use message. Mocking the errno
		// keeps this portable across POSIX/Windows and privileged/unprivileged runs.
		httpControl.listenError = "EACCES";
		await expect(startAuthorize()).rejects.toThrow(/EACCES/);
		// The branch must NOT translate it into the EADDRINUSE "port in use" message.
		httpControl.listenError = "EACCES";
		await expect(startAuthorize()).rejects.not.toThrow(/is in use/);
	});

	it("uses an empty domain in the result URLs when no domain is provided", async () => {
		const { redirectUrl, authorize, close } = await startLoopbackAuthorize({
			logger: silentLogger,
			port: 0,
		});
		try {
			let pending: Promise<Response> | undefined;
			mockElectron.shell.openExternal.mockImplementationOnce(async () => {
				pending = fetch(`${redirectUrl}?code=xyz`, { redirect: "manual" });
			});
			await authorize(AUTH_URL);
			const response = await pending;
			expect(response?.headers.get("location")).toBe("https:///app/local-login-success");
		} finally {
			close();
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
