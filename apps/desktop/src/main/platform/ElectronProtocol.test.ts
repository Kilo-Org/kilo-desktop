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
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	type EmbeddedWebHost,
} from "@kilo-desktop/feature-sdk/main";

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
	it("uses distinct Kilo Desktop schemes", () => {
		expect(getDesktopUrl(false)).toBe("kilo-desktop://app/#/");
		expect(getDesktopUrl(true)).toBe("kilo-desktop-dev://app/#/");
	});

	it("registers privileged desktop schemes", () => {
		registerDesktopSchemes(["kilo-git"]);
		expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith(
			expect.arrayContaining([
				expect.objectContaining({ scheme: "kilo-desktop" }),
				expect.objectContaining({ scheme: "kilo-desktop-dev" }),
				// Plugin protocol schemes are manifest-declared (mainSdk.protocol).
				expect.objectContaining({
					scheme: "kilo-git",
					privileges: expect.objectContaining({ supportFetchAPI: true, stream: true }),
				}),
			]),
		);
	});

	it("binds and unbinds plugin protocol schemes (mainSdk.protocol)", () => {
		const adapter = new ElectronProtocol();
		const handler = () => new Response("ok");
		adapter.registerFeatureScheme("kilo-git", handler);
		expect(handle).toHaveBeenCalledWith("kilo-git", handler);

		// A repeated registration replaces the handler, mirroring Electron.
		const replacement = () => new Response("replaced");
		adapter.registerFeatureScheme("kilo-git", replacement);
		expect(handle).toHaveBeenLastCalledWith("kilo-git", replacement);

		adapter.unregisterFeatureScheme("kilo-git");
		expect(protocol.unhandle).toHaveBeenCalledWith("kilo-git");
		// Unregistering an unbound scheme (e.g. teardown after unregister) is a no-op.
		expect(() => adapter.unregisterFeatureScheme("kilo-git")).not.toThrow();
	});

	it("creates a restrictive production CSP", () => {
		const policy = createContentSecurityPolicy(undefined, [], [], ["kilo-git"]);
		expect(policy).toContain("default-src 'self'");
		expect(policy).toContain("connect-src 'self'");
		// Plugin protocol schemes (mainSdk.protocol) are connectable.
		expect(policy).toContain("kilo-git:");
		expect(policy).toContain("http://127.0.0.1:*");
		expect(policy).not.toContain("http://localhost:*");
		expect(policy).toContain("object-src 'none'");
		// `'self'` (not `'none'`): the relay widget iframe is same-origin. Still
		// blocks cross-origin framing — no external origins exist under the scheme.
		expect(policy).toContain("frame-ancestors 'self'");
		// Bundled DotLottie WASM (not `'unsafe-eval'`, which would allow JS eval).
		expect(policy).toContain("'wasm-unsafe-eval'");
		expect(policy).not.toContain("'unsafe-eval'");
		expect(policy).not.toContain("https:");
		expect(policy).not.toContain("wss:");
	});

	it("emits plugin scheme connect-src entries from the register input", async () => {
		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: false,
			rendererRoot: "/unused",
			pluginSchemes: ["kilo-git"],
		});
		const protocolHandler = handle.mock.calls.at(-1)?.[1] as (
			request: Request,
		) => Promise<Response>;

		const response = await protocolHandler(new Request("kilo-desktop://app/missing"));

		expect(response.headers.get("Content-Security-Policy")).toContain("kilo-git:");
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

	it("keeps 'unsafe-inline' in development for Vite HMR", async () => {
		// Development serves through Vite, which injects and rewrites inline
		// scripts at runtime that a static hash allowlist cannot cover, so dev
		// retains 'unsafe-inline'. Production hash-pins instead (see below).
		fetch.mockResolvedValue(
			new Response(`<script>window.startDesktop()</script>`, {
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

		const response = await protocolHandler(new Request("kilo-desktop-dev://app/"));

		const scriptSrc = response.headers
			.get("Content-Security-Policy")
			?.split(";")
			.find((directive) => directive.trimStart().startsWith("script-src"));
		expect(scriptSrc).toContain("'unsafe-inline'");
		// JS eval stays blocked. `'wasm-unsafe-eval'` is only for bundled WASM.
		expect(scriptSrc).toContain("'wasm-unsafe-eval'");
		expect(scriptSrc).not.toContain("'unsafe-eval'");
	});

	it("hash-pins inline scripts and forbids 'unsafe-inline' in production (EoP 7)", async () => {
		// The trusted app origin holds the preload bridge, so it must not allow
		// arbitrary inline script. Each shipped inline script is pinned by its
		// sha256; an injected inline script is therefore refused by the browser.
		// MCP App widgets no longer force 'unsafe-inline' here — they render under
		// the isolated `mcp-app` origin.
		const root = await mkdtemp(path.join(os.tmpdir(), "kilo-desktop-renderer-"));
		temporaryDirectories.push(root);
		const inlineScript = "window.startDesktop()";
		await writeFile(
			path.join(root, "index.html"),
			`<!doctype html><script>${inlineScript}</script>`,
		);
		const adapter = new ElectronProtocol();
		adapter.register({ isDevelopment: false, rendererRoot: root });
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const response = await protocolHandler(new Request("kilo-desktop://app/"));

		const scriptSrc =
			response.headers
				.get("Content-Security-Policy")
				?.split(";")
				.find((directive) => directive.trimStart().startsWith("script-src")) ?? "";
		expect(scriptSrc).not.toContain("'unsafe-inline'");
		const expectedHash = createHash("sha256").update(inlineScript).digest("base64");
		expect(scriptSrc).toContain(`'sha256-${expectedHash}'`);
		expect(scriptSrc).toContain("'wasm-unsafe-eval'");
		expect(scriptSrc).not.toContain("'unsafe-eval'");
	});

	it("ignores a development origin in a packaged build so the strict CSP holds (EoP 7)", async () => {
		// `developmentOrigin` derives from `KILO_WEB_DEV_SERVER_URL`, which can leak
		// into a packaged app's environment. It must NOT re-enable 'unsafe-inline'
		// or widen script/connect-src to the dev origin when `isDevelopment` is
		// false — the production guarantee has to be structural, not env-dependent.
		const root = await mkdtemp(path.join(os.tmpdir(), "kilo-desktop-renderer-"));
		temporaryDirectories.push(root);
		await writeFile(
			path.join(root, "index.html"),
			`<!doctype html><script>window.startDesktop()</script>`,
		);
		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: false,
			developmentOrigin: "http://localhost:5173",
			rendererRoot: root,
		});
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const csp = (await protocolHandler(new Request("kilo-desktop://app/"))).headers.get(
			"Content-Security-Policy",
		);
		const directive = (name: string) =>
			csp?.split(";").find((entry) => entry.trimStart().startsWith(name)) ?? "";
		expect(directive("script-src")).not.toContain("'unsafe-inline'");
		expect(directive("script-src")).toContain("'sha256-");
		expect(directive("script-src")).not.toContain("localhost:5173");
		expect(directive("script-src")).not.toContain("ws:");
		expect(directive("connect-src")).not.toContain("localhost:5173");
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
			new Request("kilo-desktop-dev://app/@vite/client", {
				headers: { origin: "kilo-desktop-dev://app" },
			}),
		);

		expect(fetch).toHaveBeenCalledWith("http://localhost:5173/@vite/client", {
			method: "GET",
		});
		expect(await response.text()).toBe("renderer");
	});

	it("serves production renderer files and rejects unknown hosts", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "kilo-desktop-renderer-"));
		temporaryDirectories.push(root);
		await writeFile(path.join(root, "index.html"), "<html>home</html>");
		await writeFile(path.join(root, "asset.bin"), "binary");
		await writeFile(path.join(root, "mark.lottie"), "zip");

		const adapter = new ElectronProtocol();
		adapter.register({ isDevelopment: false, rendererRoot: root });
		adapter.register({ isDevelopment: false, rendererRoot: root });
		expect(handle).toHaveBeenCalledTimes(1);

		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const html = await protocolHandler(new Request("kilo-desktop://app/"));
		expect(html.status).toBe(200);
		expect(html.headers.get("Content-Type")).toContain("text/html");
		expect(html.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(await html.text()).toBe("<html>home</html>");

		const unknown = await protocolHandler(new Request("kilo-desktop://app/asset.bin"));
		expect(unknown.headers.get("Content-Type")).toBe("application/octet-stream");

		const lottie = await protocolHandler(new Request("kilo-desktop://app/mark.lottie"));
		expect(lottie.headers.get("Content-Type")).toBe("application/zip");

		const missing = await protocolHandler(new Request("kilo-desktop://app/missing.js"));
		expect(missing.status).toBe(404);

		const foreignHost = await protocolHandler(new Request("kilo-desktop://evil/"));
		expect(foreignHost.status).toBe(404);

		adapter.dispose();
		expect(protocol.unhandle).toHaveBeenCalledWith("kilo-desktop");
		adapter.dispose();
	});

	it("serves the relay widget fetch probe (v5 embed.js builds the blob iframe from it)", async () => {
		// `@mcp-b/webmcp-local-relay@5` embed.js fetches widget.html and inlines it
		// into a blob: iframe; there is no direct-iframe fallback anymore, so a 404
		// here leaves the relay with zero connected sources.
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
			new Request("kilo-desktop-dev://app/webmcp/widget.html", {
				headers: { "Sec-Fetch-Dest": "empty" },
			}),
		);

		expect(fetch).toHaveBeenCalledWith("http://localhost:5173/webmcp/widget.html", {
			method: "GET",
		});
		expect(response.status).toBe(200);
	});

	it("serves the relay widget from the filesystem in production", async () => {
		// v5 embed.js has no fallback when the widget fetch fails, so the
		// production filesystem path must serve it for probe-shaped requests.
		const root = await mkdtemp(path.join(os.tmpdir(), "kilo-desktop-renderer-"));
		temporaryDirectories.push(root);
		await mkdir(path.join(root, "webmcp"));
		await writeFile(path.join(root, "webmcp", "widget.html"), "<html>widget</html>");

		const adapter = new ElectronProtocol();
		adapter.register({ isDevelopment: false, rendererRoot: root });
		const protocolHandler = handle.mock.calls.at(-1)?.[1] as (
			request: Request,
		) => Promise<Response>;

		const response = await protocolHandler(
			new Request("kilo-desktop://app/webmcp/widget.html"),
			// no Sec-Fetch-Dest, no query string — the probe shape
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toContain("text/html");
		expect(await response.text()).toBe("<html>widget</html>");
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
			new Request("kilo-desktop-dev://app/webmcp/widget.html", {
				headers: { "Sec-Fetch-Dest": "iframe", Accept: "text/html" },
			}),
		);

		expect(fetch).toHaveBeenCalledWith("http://localhost:5173/webmcp/widget.html", {
			method: "GET",
		});
		expect(response.status).toBe(200);
	});

	it("serves the relay widget for iframe navigations even when Sec-Fetch-Dest is missing (custom scheme)", async () => {
		// Under our custom scheme, Chromium does not always populate Sec-Fetch-Dest
		// for iframe navigations — serving must not depend on those headers.
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
				"kilo-desktop-dev://app/webmcp/widget.html?tabId=abc123&hostOrigin=kilo-desktop-dev%3A%2F%2Fapp",
				// no Sec-Fetch-Dest, no Accept
			),
		);

		expect(fetch).toHaveBeenCalledWith(
			"http://localhost:5173/webmcp/widget.html?tabId=abc123&hostOrigin=kilo-desktop-dev%3A%2F%2Fapp",
			{ method: "GET" },
		);
		expect(response.status).toBe(200);
	});

	it("serves the fetch() probe even without query string or iframe headers", async () => {
		// Chromium does not always populate Sec-Fetch-* under the custom scheme;
		// probe detection must not be a condition for serving the widget at all.
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
			new Request("kilo-desktop-dev://app/webmcp/widget.html"),
			// no headers, no query — this is the probe shape
		);

		expect(response.status).toBe(200);
	});

	it("matches an embedded host exactly", () => {
		const hosts: EmbeddedWebHost[] = [{ host: "canvas", root: "/bundle" }];
		expect(findEmbeddedHost(hosts, "canvas")).toBe(hosts[0]);
		// A near-miss must not borrow the contributed host's policy.
		expect(findEmbeddedHost(hosts, "canvas.evil")).toBeUndefined();
		expect(findEmbeddedHost([], "canvas")).toBeUndefined();
	});

	it("grants an embedded bundle only what it needs, and names the app as its framer", () => {
		const policy = createEmbeddedContentSecurityPolicy("kilo-desktop://app");
		expect(policy).toContain("'wasm-unsafe-eval'");
		expect(policy).not.toContain("ws://127.0.0.1:*");
		expect(policy).toContain("worker-src 'self' blob:");
		expect(policy).toContain("frame-ancestors kilo-desktop://app");
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
		expect(createEmbeddedContentSecurityPolicy("kilo-desktop://app")).not.toContain(
			"cdn.bokeh.org",
		);
		expect(createEmbeddedContentSecurityPolicy("kilo-desktop://app")).not.toContain(
			"cdn.holoviz.org",
		);
	});

	it("serves an embedded host from its own root under its own policy", async () => {
		const appRoot = await mkdtemp(path.join(os.tmpdir(), "kilo-desktop-renderer-"));
		const enclosing = await mkdtemp(path.join(os.tmpdir(), "kilo-desktop-enclosing-"));
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

		const shell = await protocolHandler(new Request("kilo-desktop://canvas/"));
		expect(shell.status).toBe(200);
		expect(await shell.text()).toBe("<html>canvas</html>");
		expect(shell.headers.get("Content-Security-Policy")).toContain("'wasm-unsafe-eval'");
		expect(shell.headers.get("Content-Security-Policy")).not.toContain("'unsafe-eval'");

		const activeFrame = await protocolHandler(
			new Request("kilo-desktop://canvas/active-frame.html"),
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
		const wasm = await protocolHandler(new Request("kilo-desktop://canvas/assets/module.wasm"));
		expect(wasm.headers.get("Content-Type")).toBe("application/wasm");

		const config = await protocolHandler(new Request("kilo-desktop://canvas/runtime/config"));
		expect(await config.json()).toEqual({ token: "t" });
		expect(configRoute).toHaveBeenCalledWith({
			origin: "kilo-desktop://canvas",
		});

		// The app keeps its strict policy and only learns to frame the sibling host.
		// `blob:` is present so MCP App widgets can render in sandboxed blob-URL iframes.
		const appShell = await protocolHandler(new Request("kilo-desktop://app/"));
		const appPolicy = appShell.headers.get("Content-Security-Policy") ?? "";
		expect(appPolicy).toContain("frame-src 'self' blob: kilo-desktop://canvas");
		expect(appPolicy).toContain("frame-ancestors 'self'");
		expect(appPolicy).toContain("'wasm-unsafe-eval'");
		expect(appPolicy).not.toContain("'unsafe-eval'");

		// New caller of resolveRendererPath, so assert containment holds for it too.
		const escape = await protocolHandler(
			new Request("kilo-desktop://canvas/%2e%2e/secret-sibling"),
		);
		expect(escape.status).toBe(404);
		expect(escape.headers.get("Content-Security-Policy")).toContain("'wasm-unsafe-eval'");
	});

	it("serves an inline document under the active-untrusted policy", async () => {
		const appRoot = await mkdtemp(path.join(os.tmpdir(), "kilo-desktop-renderer-"));
		temporaryDirectories.push(appRoot);
		await writeFile(path.join(appRoot, "index.html"), "app");

		const adapter = new ElectronProtocol();
		adapter.register({
			isDevelopment: false,
			rendererRoot: appRoot,
			embeddedHosts: () => [
				{
					host: "mcp-app",
					root: undefined,
					documents: { "/widget-host.html": "<!doctype html><body><script>1</script></body>" },
					securityProfiles: {
						"/widget-host.html": ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
					},
				},
			],
		});
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const shell = await protocolHandler(new Request("kilo-desktop://mcp-app/widget-host.html"));
		expect(shell.status).toBe(200);
		expect(shell.headers.get("Content-Type")).toContain("text/html");
		expect(await shell.text()).toContain("<!doctype html>");
		// The isolated widget origin — not the app — is the one that may run inline scripts.
		const shellScriptSrc = (shell.headers.get("Content-Security-Policy") ?? "")
			.split(";")
			.find((directive) => directive.trimStart().startsWith("script-src"));
		expect(shellScriptSrc).toContain("'unsafe-inline'");

		// A document path with no bundled root still 404s for anything else.
		const missing = await protocolHandler(new Request("kilo-desktop://mcp-app/other.html"));
		expect(missing.status).toBe(404);

		// The app origin learns to frame the widget host but keeps its own strict policy.
		const appShell = await protocolHandler(new Request("kilo-desktop://app/"));
		const appPolicy = appShell.headers.get("Content-Security-Policy") ?? "";
		expect(appPolicy).toContain("kilo-desktop://mcp-app");
		const appScriptSrc =
			appPolicy.split(";").find((directive) => directive.trimStart().startsWith("script-src")) ??
			"";
		expect(appScriptSrc).not.toContain("'unsafe-inline'");
	});

	it("keeps the app policy byte-identical when no host is contributed", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "kilo-desktop-renderer-"));
		temporaryDirectories.push(root);
		await writeFile(path.join(root, "index.html"), "app");

		const adapter = new ElectronProtocol();
		adapter.register({ isDevelopment: false, rendererRoot: root, embeddedHosts: () => [] });
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		const response = await protocolHandler(new Request("kilo-desktop://app/"));
		expect(response.headers.get("Content-Security-Policy")).toBe(createContentSecurityPolicy());
		const unknown = await protocolHandler(new Request("kilo-desktop://canvas/"));
		expect(unknown.status).toBe(404);
	});

	it("reads contributed hosts per request, since features boot after registration", async () => {
		const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "kilo-desktop-canvas-"));
		temporaryDirectories.push(bundleRoot);
		await writeFile(path.join(bundleRoot, "index.html"), "late");

		// Mirrors Application.start: protocol.register runs before bootFeatures, so a
		// snapshotted array would be empty for the process's whole lifetime.
		let hosts: readonly EmbeddedWebHost[] = [];
		const adapter = new ElectronProtocol();
		adapter.register({ isDevelopment: false, rendererRoot: "/unused", embeddedHosts: () => hosts });
		const protocolHandler = handle.mock.calls[0]?.[1] as (request: Request) => Promise<Response>;

		expect((await protocolHandler(new Request("kilo-desktop://canvas/"))).status).toBe(404);
		hosts = [{ host: "canvas", root: bundleRoot }];
		const served = await protocolHandler(new Request("kilo-desktop://canvas/"));
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
		const response = await protocolHandler(new Request("kilo-desktop://canvas/"));
		expect(response.status).toBe(404);
	});

	it("prefers a route over a file the bundle ships at the same path", async () => {
		const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "kilo-desktop-canvas-"));
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

		const response = await protocolHandler(new Request("kilo-desktop://canvas/runtime/config"));
		expect(await response.json()).toEqual({ live: true });
	});

	it("does not proxy embedded-host requests to the web dev server", async () => {
		const bundleRoot = await mkdtemp(path.join(os.tmpdir(), "kilo-desktop-canvas-"));
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
			new Request("kilo-desktop-dev://canvas/assets/widget.js"),
		);

		// The Vite server serves the app, not embedded bundles; proxying would 404.
		expect(fetch).not.toHaveBeenCalled();
		expect(await response.text()).toBe("canvas chunk");
	});

	it("resolves the SPA shell and assets inside the renderer root", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "kilo-desktop-renderer-"));
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
