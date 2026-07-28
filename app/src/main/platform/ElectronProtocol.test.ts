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

import {
	createContentSecurityPolicy,
	ElectronProtocol,
	getDesktopUrl,
	resolveRendererPath,
} from "./ElectronProtocol.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
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

	it("creates a restrictive production CSP", () => {
		const policy = createContentSecurityPolicy();
		expect(policy).toContain("default-src 'self'");
		expect(policy).toContain("connect-src 'self'");
		expect(policy).toContain("object-src 'none'");
		expect(policy).toContain("frame-ancestors 'none'");
		expect(policy).not.toContain("unsafe-eval");
		expect(policy).not.toContain("https:");
		expect(policy).not.toContain("wss:");
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

	it("resolves assets and prerendered routes inside the renderer root", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "anaconda-agentic-desktop-renderer-"));
		temporaryDirectories.push(root);
		await writeFile(path.join(root, "index.html"), "home");
		await mkdir(path.join(root, "settings"));
		await writeFile(path.join(root, "settings", "index.html"), "settings");

		await expect(resolveRendererPath(root, "/")).resolves.toBe(path.join(root, "index.html"));
		await expect(resolveRendererPath(root, "/settings/")).resolves.toBe(
			path.join(root, "settings", "index.html"),
		);
		await expect(resolveRendererPath(root, "/missing")).resolves.toBeUndefined();
		await expect(resolveRendererPath(root, "/%2e%2e/secret")).resolves.toBeUndefined();
	});
});
