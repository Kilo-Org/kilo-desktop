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
	createEmbeddedContentSecurityPolicy,
	createIsolatedOutputContentSecurityPolicy,
	ElectronProtocol,
	findEmbeddedHost,
	getDesktopUrl,
	registerDesktopSchemes,
	resolveRendererPath,
	type EmbeddedWebHost,
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
		const hosts: EmbeddedWebHost[] = [{ host: "notebook", root: "/bundle" }];
		expect(findEmbeddedHost(hosts, "notebook")).toBe(hosts[0]);
		// A near-miss must not borrow the notebook's looser policy.
		expect(findEmbeddedHost(hosts, "notebook.evil")).toBeUndefined();
		expect(findEmbeddedHost([], "notebook")).toBeUndefined();
	});

	it("grants an embedded bundle only what it needs, and names the app as its framer", () => {
		const policy = createEmbeddedContentSecurityPolicy("anaconda-agentic-desktop://app");
		expect(policy).toContain("'wasm-unsafe-eval'");
		expect(policy).not.toContain("ws://127.0.0.1:*");
		expect(policy).toContain("worker-src 'self' blob:");
		expect(policy).toContain("frame-ancestors anaconda-agentic-desktop://app");
		// A wasm grant is not an eval grant; nteract's plot renderers stay blocked (D5).
		expect(policy).not.toContain("'unsafe-eval'");
	});

	it("grants unsafe eval only to the isolated output profile", () => {
		const policy = createIsolatedOutputContentSecurityPolicy("anaconda-agentic-desktop://notebook");
		expect(policy).toContain("'unsafe-eval'");
		expect(policy).toContain("'wasm-unsafe-eval'");
		expect(policy).toContain("frame-ancestors anaconda-agentic-desktop://notebook");
		expect(policy).toContain("object-src 'none'");
	});

	it("serves an embedded host from its own root under its own policy", async () => {
		const appRoot = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-renderer-"));
		const enclosing = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-enclosing-"));
		const bundleRoot = path.join(enclosing, "notebook");
		temporaryDirectories.push(appRoot, enclosing);
		await mkdir(bundleRoot);
		await writeFile(path.join(appRoot, "index.html"), "<html>app</html>");
		await writeFile(path.join(bundleRoot, "index.html"), "<html>notebook</html>");
		await writeFile(path.join(bundleRoot, "output-frame.html"), "<html>output</html>");
		await mkdir(path.join(bundleRoot, "assets"));
		await writeFile(path.join(bundleRoot, "assets", "runtimed_bg.wasm"), "\0asm");
		// Outside the bundle root, so a successful traversal would actually leak it.
		await writeFile(path.join(enclosing, "secret-sibling"), "no");
		const configRoute = vi.fn(async () => ({ token: "t" }));

		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: false,
			rendererRoot: appRoot,
			embeddedHosts: () => [
				{
					host: "notebook",
					root: bundleRoot,
					routes: { "/__nteract_dev_relay/config": configRoute },
					securityProfiles: { "/output-frame.html": "isolated-output" },
				},
			],
		});
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const shell = await protocolHandler(new Request("anaconda-agentic-desktop://notebook/"));
		expect(shell.status).toBe(200);
		expect(await shell.text()).toBe("<html>notebook</html>");
		expect(shell.headers.get("Content-Security-Policy")).toContain("'wasm-unsafe-eval'");
		expect(shell.headers.get("Content-Security-Policy")).not.toContain("'unsafe-eval'");

		const output = await protocolHandler(
			new Request("anaconda-agentic-desktop://notebook/output-frame.html"),
		);
		expect(await output.text()).toBe("<html>output</html>");
		expect(output.headers.get("Content-Security-Policy")).toContain("'unsafe-eval'");
		expect(output.headers.get("Content-Security-Policy")).toContain(
			"frame-ancestors anaconda-agentic-desktop://notebook",
		);

		// Streaming wasm compilation rejects any other MIME type.
		const wasm = await protocolHandler(
			new Request("anaconda-agentic-desktop://notebook/assets/runtimed_bg.wasm"),
		);
		expect(wasm.headers.get("Content-Type")).toBe("application/wasm");

		const config = await protocolHandler(
			new Request("anaconda-agentic-desktop://notebook/__nteract_dev_relay/config"),
		);
		expect(await config.json()).toEqual({ token: "t" });
		expect(configRoute).toHaveBeenCalledWith({
			origin: "anaconda-agentic-desktop://notebook",
		});

		// The app keeps its strict policy and only learns to frame the sibling host.
		const appShell = await protocolHandler(new Request("anaconda-agentic-desktop://app/"));
		const appPolicy = appShell.headers.get("Content-Security-Policy") ?? "";
		expect(appPolicy).toContain("frame-src 'self' anaconda-agentic-desktop://notebook");
		expect(appPolicy).toContain("frame-ancestors 'self'");
		expect(appPolicy).not.toContain("wasm-unsafe-eval");

		// New caller of resolveRendererPath, so assert containment holds for it too.
		const escape = await protocolHandler(
			new Request("anaconda-agentic-desktop://notebook/%2e%2e/secret-sibling"),
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
		const unknown = await protocolHandler(new Request("anaconda-agentic-desktop://notebook/"));
		expect(unknown.status).toBe(404);
	});

	it("reads contributed hosts per request, since features boot after registration", async () => {
		const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-notebook-"));
		temporaryDirectories.push(bundleRoot);
		await writeFile(path.join(bundleRoot, "index.html"), "late");

		// Mirrors Application.start: protocol.register runs before bootFeatures, so a
		// snapshotted array would be empty for the process's whole lifetime.
		let hosts: readonly EmbeddedWebHost[] = [];
		const adapter = new ElectronProtocol();
		adapter.register({ isDevelopment: false, rendererRoot: "/unused", embeddedHosts: () => hosts });
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		expect(
			(await protocolHandler(new Request("anaconda-agentic-desktop://notebook/"))).status,
		).toBe(404);
		hosts = [{ host: "notebook", root: bundleRoot }];
		const served = await protocolHandler(new Request("anaconda-agentic-desktop://notebook/"));
		expect(await served.text()).toBe("late");
	});

	it("serves 404 for a contributed host that ships no bundle", async () => {
		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: false,
			rendererRoot: "/unused",
			embeddedHosts: () => [{ host: "notebook", root: undefined }],
		});
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		// An expected state, not an error: this build bundles no notebook UI.
		const response = await protocolHandler(new Request("anaconda-agentic-desktop://notebook/"));
		expect(response.status).toBe(404);
	});

	it("prefers a route over a file the bundle ships at the same path", async () => {
		const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-notebook-"));
		temporaryDirectories.push(bundleRoot);
		await mkdir(path.join(bundleRoot, "__nteract_dev_relay"), { recursive: true });
		await writeFile(path.join(bundleRoot, "__nteract_dev_relay", "config"), "stale-from-disk");

		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: false,
			rendererRoot: "/unused",
			embeddedHosts: () => [
				{
					host: "notebook",
					root: bundleRoot,
					routes: { "/__nteract_dev_relay/config": async () => ({ live: true }) },
				},
			],
		});
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const response = await protocolHandler(
			new Request("anaconda-agentic-desktop://notebook/__nteract_dev_relay/config"),
		);
		expect(await response.json()).toEqual({ live: true });
	});

	it("does not proxy embedded-host requests to the web dev server", async () => {
		const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-notebook-"));
		temporaryDirectories.push(bundleRoot);
		await mkdir(path.join(bundleRoot, "assets"));
		await writeFile(path.join(bundleRoot, "assets", "nteract.js"), "notebook chunk");

		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: true,
			rendererRoot: "/unused",
			developmentOrigin: "http://localhost:5173",
			embeddedHosts: () => [{ host: "notebook", root: bundleRoot }],
		});
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const response = await protocolHandler(
			new Request("anaconda-agentic-desktop-dev://notebook/assets/nteract.js"),
		);

		// The Vite server serves the app, not nteract — proxying here would 404.
		expect(fetch).not.toHaveBeenCalled();
		expect(await response.text()).toBe("notebook chunk");
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
