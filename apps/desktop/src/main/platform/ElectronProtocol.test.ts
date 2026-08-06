import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const { fetch, handle } = vi.hoisted(() => ({
	fetch: vi.fn(),
	handle: vi.fn(),
}));

vi.mock("electron", () => ({
	net: { fetch },
	protocol: {
		handle,
		registerSchemesAsPrivileged: vi.fn(),
		unhandle: vi.fn(),
	},
}));

import { protocol } from "electron";

import {
	createContentSecurityPolicy,
	ElectronProtocol,
	getDesktopUrl,
	registerDesktopSchemes,
	resolveRendererPath,
} from "./ElectronProtocol.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	handle.mockClear();
	fetch.mockReset();
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("ElectronProtocol", () => {
	it("uses distinct Anaconda Desktop schemes", () => {
		expect(getDesktopUrl(false)).toBe("anaconda-agentic-desktop://app/#/");
		expect(getDesktopUrl(true)).toBe("anaconda-agentic-desktop-dev://app/#/");
	});

	it("registers privileged desktop schemes", () => {
		registerDesktopSchemes();
		expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ scheme: "anaconda-agentic-desktop" }),
				expect.objectContaining({ scheme: "anaconda-agentic-desktop-dev" }),
			]),
		);
	});

	it("creates a restrictive production CSP", () => {
		const policy = createContentSecurityPolicy();
		expect(policy).toContain("default-src 'self'");
		expect(policy).toContain("connect-src 'self'");
		expect(policy).toContain("http://127.0.0.1:*");
		expect(policy).not.toContain("http://localhost:*");
		expect(policy).toContain("object-src 'none'");
		// `'self'` (not `'none'`): the relay widget iframe is same-origin. Still
		// blocks cross-origin framing — no external origins exist under the scheme.
		expect(policy).toContain("frame-ancestors 'self'");
		expect(policy).not.toContain("unsafe-eval");
		expect(policy).not.toContain("https:");
		expect(policy).not.toContain("wss:");
	});

	it("allows the self-hosted WebMCP relay (same-origin frame + loopback websockets)", () => {
		const policy = createContentSecurityPolicy();
		const connectSrc = policy
			.split(";")
			.map((directive) => directive.trim())
			.find((directive) => directive.startsWith("connect-src"));
		// Scoped to the relay's discovery range on IPv4 loopback, not a `:*`
		// wildcard. IPv6 literals are omitted — Chromium rejects them as invalid
		// CSP sources.
		expect(connectSrc).toContain("ws://127.0.0.1:9333");
		expect(connectSrc).toContain("ws://127.0.0.1:9348");
		expect(connectSrc).not.toContain("ws://[::1]");
		expect(connectSrc).not.toContain("ws://127.0.0.1:*");
		expect(policy).toContain("frame-src 'self'");
		// The relay widget loads in a same-origin iframe, so the shared CSP must
		// allow same-origin framing; `'none'` would block it.
		expect(policy).toContain("frame-ancestors 'self'");
		expect(policy).not.toContain("frame-ancestors 'none'");
	});

	it("allows only the inline scripts present in an HTML response", async () => {
		const inlineScript = "window.startDesktop()";
		const expectedHash = createHash("sha256").update(inlineScript).digest("base64");
		fetch.mockResolvedValue(
			new Response(`<script>${inlineScript}</script>`, {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			}),
		);
		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: true,
			rendererRoot: "/unused",
			developmentOrigin: "http://localhost:5173",
		});
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const response = await protocolHandler(new Request("anaconda-agentic-desktop-dev://app/"));

		expect(response.headers.get("Content-Security-Policy")).toContain(`'sha256-${expectedHash}'`);
		expect(
			response.headers
				.get("Content-Security-Policy")
				?.split(";")
				.find((directive) => directive.trimStart().startsWith("script-src")),
		).not.toContain("'unsafe-inline'");
	});

	it("proxies development requests without forwarding custom-scheme headers", async () => {
		fetch.mockResolvedValue(new Response("renderer"));
		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: true,
			rendererRoot: "/unused",
			developmentOrigin: "http://localhost:5173",
		});
		const protocolHandler = handle.mock.calls.at(-1)?.[1] as (
			request: Request,
		) => Promise<Response>;

		const response = await protocolHandler(
			new Request("anaconda-agentic-desktop-dev://app/@vite/client", {
				headers: { origin: "anaconda-agentic-desktop-dev://app" },
			}),
		);

		expect(fetch).toHaveBeenCalledWith("http://localhost:5173/@vite/client", {
			method: "GET",
		});
		expect(await response.text()).toBe("renderer");
	});

	it("serves production renderer files and rejects unknown hosts", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-renderer-"));
		temporaryDirectories.push(root);
		await writeFile(path.join(root, "index.html"), "<html>home</html>");
		await writeFile(path.join(root, "asset.bin"), "binary");

		const adapter = new ElectronProtocol();
		adapter.register({ isDevelopment: false, rendererRoot: root });
		adapter.register({ isDevelopment: false, rendererRoot: root });
		expect(handle).toHaveBeenCalledTimes(1);

		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const html = await protocolHandler(new Request("anaconda-agentic-desktop://app/"));
		expect(html.status).toBe(200);
		expect(html.headers.get("Content-Type")).toContain("text/html");
		expect(html.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(await html.text()).toBe("<html>home</html>");

		const unknown = await protocolHandler(new Request("anaconda-agentic-desktop://app/asset.bin"));
		expect(unknown.headers.get("Content-Type")).toBe("application/octet-stream");

		const missing = await protocolHandler(new Request("anaconda-agentic-desktop://app/missing.js"));
		expect(missing.status).toBe(404);

		const foreignHost = await protocolHandler(new Request("anaconda-agentic-desktop://evil/"));
		expect(foreignHost.status).toBe(404);

		adapter.dispose();
		expect(protocol.unhandle).toHaveBeenCalledWith("anaconda-agentic-desktop");
		adapter.dispose();
	});

	it("fails the relay widget fetch probe so embed.js uses the direct iframe path", async () => {
		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: true,
			rendererRoot: "/unused",
			developmentOrigin: "http://localhost:5173",
		});
		const protocolHandler = handle.mock.calls.at(-1)?.[1] as (
			request: Request,
		) => Promise<Response>;

		const response = await protocolHandler(
			new Request("anaconda-agentic-desktop-dev://app/webmcp/widget.html", {
				headers: { "Sec-Fetch-Dest": "empty" },
			}),
		);

		expect(response.status).toBe(404);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("serves the relay widget for iframe navigations", async () => {
		fetch.mockResolvedValue(
			new Response("<html></html>", {
				headers: { "Content-Type": "text/html; charset=utf-8" },
			}),
		);
		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: true,
			rendererRoot: "/unused",
			developmentOrigin: "http://localhost:5173",
		});
		const protocolHandler = handle.mock.calls.at(-1)?.[1] as (
			request: Request,
		) => Promise<Response>;

		const response = await protocolHandler(
			new Request("anaconda-agentic-desktop-dev://app/webmcp/widget.html", {
				headers: { "Sec-Fetch-Dest": "iframe", Accept: "text/html" },
			}),
		);

		expect(fetch).toHaveBeenCalledWith("http://localhost:5173/webmcp/widget.html", {
			method: "GET",
		});
		expect(response.status).toBe(200);
	});

	it("resolves the SPA shell and assets inside the renderer root", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-renderer-"));
		temporaryDirectories.push(root);
		await writeFile(path.join(root, "index.html"), "home");
		await mkdir(path.join(root, "assets"));
		await writeFile(path.join(root, "assets", "app.js"), "console.log(1)");
		await mkdir(path.join(root, "settings"));
		await writeFile(path.join(root, "settings", "index.html"), "settings");

		await expect(resolveRendererPath(root, "/")).resolves.toBe(path.join(root, "index.html"));
		await expect(resolveRendererPath(root, "/assets/app.js")).resolves.toBe(
			path.join(root, "assets", "app.js"),
		);
		await expect(resolveRendererPath(root, "/settings/")).resolves.toBeUndefined();
		await expect(resolveRendererPath(root, "/missing")).resolves.toBeUndefined();
		await expect(resolveRendererPath(root, "/%2e%2e/secret")).resolves.toBeUndefined();
		await expect(resolveRendererPath(root, "/%00secret")).resolves.toBeUndefined();
		await expect(resolveRendererPath(root, "/%E0%A4%A")).resolves.toBeUndefined();
	});
});
