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
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	type EmbeddedWebHost,
} from "@anaconda-agentic-desktop/feature-sdk/main";

import {
	createActiveUntrustedContentSecurityPolicy,
	createContentSecurityPolicy,
	createEmbeddedContentSecurityPolicy,
	ElectronProtocol,
	findEmbeddedHost,
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

	it("allows inline scripts via 'unsafe-inline' for sandboxed MCP App iframes", async () => {
		// MCP App widgets render in sandboxed blob-URL iframes, which inherit this
		// document's CSP and ship bundled inline scripts. Because CSP ignores
		// 'unsafe-inline' when a hash/nonce is also present, the main window's
		// script-src uses blanket 'unsafe-inline' rather than the per-response hash
		// allowlist. This is a deliberate tradeoff; TODO(#<mcp-apps-csp>) moves MCP
		// App HTML onto a dedicated embedded custom-scheme origin so the main
		// window can return to a hash-based policy.
		const inlineScript = "window.startDesktop()";
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

		const scriptSrc = response.headers
			.get("Content-Security-Policy")
			?.split(";")
			.find((directive) => directive.trimStart().startsWith("script-src"));
		expect(scriptSrc).toContain("'unsafe-inline'");
		// The relaxation is scoped to inline scripts only — eval remains blocked.
		expect(scriptSrc).not.toContain("unsafe-eval");
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

	it("serves the relay widget for iframe navigations even when Sec-Fetch-Dest is missing (custom scheme)", async () => {
		// Regression: under our custom scheme, Chromium does not always
		// populate Sec-Fetch-Dest for iframe navigations. The probe/iframe
		// distinguisher must fall back to the query-string signal (probe has
		// none; iframe.src always carries tabId/hostOrigin/... from embed.js).
		// Without this fallback the iframe load 404s and Kilo sees zero tools.
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
			new Request(
				"anaconda-agentic-desktop-dev://app/webmcp/widget.html?tabId=abc123&hostOrigin=anaconda-agentic-desktop-dev%3A%2F%2Fapp",
				// no Sec-Fetch-Dest, no Accept
			),
		);

		expect(fetch).toHaveBeenCalledWith(
			"http://localhost:5173/webmcp/widget.html?tabId=abc123&hostOrigin=anaconda-agentic-desktop-dev%3A%2F%2Fapp",
			{ method: "GET" },
		);
		expect(response.status).toBe(200);
	});

	it("still returns 404 to the fetch() probe (no query string, no iframe headers)", async () => {
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
			new Request("anaconda-agentic-desktop-dev://app/webmcp/widget.html"),
			// no headers, no query — this is the probe shape
		);

		expect(response.status).toBe(404);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("matches an embedded host exactly", () => {
		const hosts: EmbeddedWebHost[] = [{ host: "canvas", root: "/bundle" }];
		expect(findEmbeddedHost(hosts, "canvas")).toBe(hosts[0]);
		// A near-miss must not borrow the contributed host's policy.
		expect(findEmbeddedHost(hosts, "canvas.evil")).toBeUndefined();
		expect(findEmbeddedHost([], "canvas")).toBeUndefined();
	});

	it("grants an embedded bundle only what it needs, and names the app as its framer", () => {
		const policy = createEmbeddedContentSecurityPolicy("anaconda-agentic-desktop://app");
		expect(policy).toContain("'wasm-unsafe-eval'");
		expect(policy).not.toContain("ws://127.0.0.1:*");
		expect(policy).toContain("worker-src 'self' blob:");
		expect(policy).toContain("frame-ancestors anaconda-agentic-desktop://app");
		// A wasm grant is not an eval grant; embedded renderers stay blocked.
		expect(policy).not.toContain("'unsafe-eval'");
	});

	it("grants script execution only to the sandboxed isolated output profile", () => {
		const policy = createActiveUntrustedContentSecurityPolicy();
		expect(policy).toContain("'unsafe-eval'");
		expect(policy).toContain("'unsafe-inline'");
		expect(policy).toContain("'wasm-unsafe-eval'");
		expect(policy).not.toContain("sha256-");
		expect(policy).not.toContain("frame-ancestors");
		expect(policy).toContain("object-src 'none'");
	});

	it("allows HoloViz CDN resources only in the sandboxed isolated output profile", () => {
		const outputPolicy = createActiveUntrustedContentSecurityPolicy();
		const scriptSrc = outputPolicy
			.split(";")
			.map((directive) => directive.trim())
			.find((directive) => directive.startsWith("script-src"));
		const styleSrc = outputPolicy
			.split(";")
			.map((directive) => directive.trim())
			.find((directive) => directive.startsWith("style-src"));

		expect(scriptSrc).toContain("https://cdn.bokeh.org");
		expect(scriptSrc).toContain("https://cdn.holoviz.org");
		expect(styleSrc).toContain("https://cdn.holoviz.org");

		expect(createContentSecurityPolicy()).not.toContain("cdn.bokeh.org");
		expect(createContentSecurityPolicy()).not.toContain("cdn.holoviz.org");
		expect(createEmbeddedContentSecurityPolicy("anaconda-agentic-desktop://app")).not.toContain(
			"cdn.bokeh.org",
		);
		expect(createEmbeddedContentSecurityPolicy("anaconda-agentic-desktop://app")).not.toContain(
			"cdn.holoviz.org",
		);
	});

	it("serves an embedded host from its own root under its own policy", async () => {
		const appRoot = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-renderer-"));
		const enclosing = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-enclosing-"));
		const bundleRoot = path.join(enclosing, "canvas");
		temporaryDirectories.push(appRoot, enclosing);
		await mkdir(bundleRoot);
		await writeFile(path.join(appRoot, "index.html"), "<html>app</html>");
		await writeFile(path.join(bundleRoot, "index.html"), "<html>canvas</html>");
		await writeFile(path.join(bundleRoot, "active-frame.html"), "<html>active</html>");
		await mkdir(path.join(bundleRoot, "assets"));
		await writeFile(path.join(bundleRoot, "assets", "module.wasm"), "\0asm");
		// Outside the bundle root, so a successful traversal would actually leak it.
		await writeFile(path.join(enclosing, "secret-sibling"), "no");
		const configRoute = vi.fn(async () => ({ token: "t" }));

		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: false,
			rendererRoot: appRoot,
			embeddedHosts: () => [
				{
					host: "canvas",
					root: bundleRoot,
					routes: { "/runtime/config": configRoute },
					securityProfiles: {
						"/active-frame.html": ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
					},
				},
			],
		});
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const shell = await protocolHandler(new Request("anaconda-agentic-desktop://canvas/"));
		expect(shell.status).toBe(200);
		expect(await shell.text()).toBe("<html>canvas</html>");
		expect(shell.headers.get("Content-Security-Policy")).toContain("'wasm-unsafe-eval'");
		expect(shell.headers.get("Content-Security-Policy")).not.toContain("'unsafe-eval'");

		const activeFrame = await protocolHandler(
			new Request("anaconda-agentic-desktop://canvas/active-frame.html"),
		);
		expect(await activeFrame.text()).toBe("<html>active</html>");
		const activeFramePolicy = activeFrame.headers.get("Content-Security-Policy") ?? "";
		const activeFrameScriptPolicy = activeFramePolicy
			.split(";")
			.find((directive) => directive.trimStart().startsWith("script-src"));
		expect(activeFrameScriptPolicy).toContain("'unsafe-eval'");
		expect(activeFrameScriptPolicy).toContain("'unsafe-inline'");
		expect(activeFramePolicy).not.toContain("frame-ancestors");

		// Streaming wasm compilation rejects any other MIME type.
		const wasm = await protocolHandler(
			new Request("anaconda-agentic-desktop://canvas/assets/module.wasm"),
		);
		expect(wasm.headers.get("Content-Type")).toBe("application/wasm");

		const config = await protocolHandler(
			new Request("anaconda-agentic-desktop://canvas/runtime/config"),
		);
		expect(await config.json()).toEqual({ token: "t" });
		expect(configRoute).toHaveBeenCalledWith({
			origin: "anaconda-agentic-desktop://canvas",
		});

		// The app keeps its strict policy and only learns to frame the sibling host.
		// `blob:` is present so MCP App widgets can render in sandboxed blob-URL iframes.
		const appShell = await protocolHandler(new Request("anaconda-agentic-desktop://app/"));
		const appPolicy = appShell.headers.get("Content-Security-Policy") ?? "";
		expect(appPolicy).toContain("frame-src 'self' blob: anaconda-agentic-desktop://canvas");
		expect(appPolicy).toContain("frame-ancestors 'self'");
		expect(appPolicy).not.toContain("wasm-unsafe-eval");

		// New caller of resolveRendererPath, so assert containment holds for it too.
		const escape = await protocolHandler(
			new Request("anaconda-agentic-desktop://canvas/%2e%2e/secret-sibling"),
		);
		expect(escape.status).toBe(404);
		expect(escape.headers.get("Content-Security-Policy")).toContain("'wasm-unsafe-eval'");
	});

	it("keeps the app policy byte-identical when no host is contributed", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-renderer-"));
		temporaryDirectories.push(root);
		await writeFile(path.join(root, "index.html"), "app");

		const adapter = new ElectronProtocol();
		adapter.register({ isDevelopment: false, rendererRoot: root, embeddedHosts: () => [] });
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const response = await protocolHandler(new Request("anaconda-agentic-desktop://app/"));
		expect(response.headers.get("Content-Security-Policy")).toBe(createContentSecurityPolicy());
		const unknown = await protocolHandler(new Request("anaconda-agentic-desktop://canvas/"));
		expect(unknown.status).toBe(404);
	});

	it("reads contributed hosts per request, since features boot after registration", async () => {
		const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-canvas-"));
		temporaryDirectories.push(bundleRoot);
		await writeFile(path.join(bundleRoot, "index.html"), "late");

		// Mirrors Application.start: protocol.register runs before bootFeatures, so a
		// snapshotted array would be empty for the process's whole lifetime.
		let hosts: readonly EmbeddedWebHost[] = [];
		const adapter = new ElectronProtocol();
		adapter.register({ isDevelopment: false, rendererRoot: "/unused", embeddedHosts: () => hosts });
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		expect((await protocolHandler(new Request("anaconda-agentic-desktop://canvas/"))).status).toBe(
			404,
		);
		hosts = [{ host: "canvas", root: bundleRoot }];
		const served = await protocolHandler(new Request("anaconda-agentic-desktop://canvas/"));
		expect(await served.text()).toBe("late");
	});

	it("serves 404 for a contributed host that ships no bundle", async () => {
		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: false,
			rendererRoot: "/unused",
			embeddedHosts: () => [{ host: "canvas", root: undefined }],
		});
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		// An expected state, not an error: this build has no embedded bundle.
		const response = await protocolHandler(new Request("anaconda-agentic-desktop://canvas/"));
		expect(response.status).toBe(404);
	});

	it("prefers a route over a file the bundle ships at the same path", async () => {
		const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-canvas-"));
		temporaryDirectories.push(bundleRoot);
		await mkdir(path.join(bundleRoot, "runtime"), { recursive: true });
		await writeFile(path.join(bundleRoot, "runtime", "config"), "stale-from-disk");

		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: false,
			rendererRoot: "/unused",
			embeddedHosts: () => [
				{
					host: "canvas",
					root: bundleRoot,
					routes: { "/runtime/config": async () => ({ live: true }) },
				},
			],
		});
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const response = await protocolHandler(
			new Request("anaconda-agentic-desktop://canvas/runtime/config"),
		);
		expect(await response.json()).toEqual({ live: true });
	});

	it("does not proxy embedded-host requests to the web dev server", async () => {
		const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-canvas-"));
		temporaryDirectories.push(bundleRoot);
		await mkdir(path.join(bundleRoot, "assets"));
		await writeFile(path.join(bundleRoot, "assets", "widget.js"), "canvas chunk");

		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: true,
			rendererRoot: "/unused",
			developmentOrigin: "http://localhost:5173",
			embeddedHosts: () => [{ host: "canvas", root: bundleRoot }],
		});
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const response = await protocolHandler(
			new Request("anaconda-agentic-desktop-dev://canvas/assets/widget.js"),
		);

		// The Vite server serves the app, not embedded bundles; proxying would 404.
		expect(fetch).not.toHaveBeenCalled();
		expect(await response.text()).toBe("canvas chunk");
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
