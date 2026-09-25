import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

import { marketplaceSnapshotSchema } from "../contracts/schemas.js";
import { mainRegister } from "./index.js";

const disposables: Array<() => Promise<void> | void> = [];

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

afterEach(async () => {
	await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

describe("kilo-marketplace mainRegister", () => {
	it("adapts Kilo Marketplace across Desktop workspaces and mutations", async () => {
		const globalDirectory = "/runtime";
		const demo = "/workspaces/demo";
		const docs = "/workspaces/docs";
		const catalogItems = [
			{
				type: "agent",
				id: "reviewer",
				name: "Reviewer",
				description: "Reviews code",
				category: "engineering",
				content: { mode: "subagent", description: "Reviews code", prompt: "Review carefully." },
			},
			{
				type: "mcp",
				id: "github",
				name: "GitHub",
				description: "Connect GitHub tools",
				category: "engineering",
				url: "https://example.com/github-mcp",
				icons: [{ src: "https://example.com/icon.png" }],
				content: [{ name: "Remote", content: '{"type":"remote","url":"{{URL}}"}' }],
			},
		];
		const requests: Array<{ url: URL; init?: RequestInit }> = [];
		const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			const url = new URL(String(input));
			requests.push({ url, ...(init ? { init } : {}) });
			if (url.pathname === "/kilocode/marketplace") {
				const directory = url.searchParams.get("directory");
				return json({
					items: catalogItems,
					installed: {
						project:
							directory === demo
								? { "agent:reviewer": { type: "agent" } }
								: { "mcp:github": { type: "mcp" } },
						global: {
							"mcp:github": { type: "mcp" },
							"skill:pyscript-best-practices": { type: "skill" },
						},
					},
				});
			}
			if (url.pathname === "/kilocode/marketplace/install") {
				return json({ success: true, slug: "github", filePath: "/installed/github.json" });
			}
			if (url.pathname === "/kilocode/marketplace/remove") {
				return json({ success: true, slug: "reviewer" });
			}
			if (url.pathname === "/mcp/github/auth/authenticate") return json({ status: "connected" });
			if (url.pathname === "/mcp") {
				return json({
					github: { status: url.searchParams.has("directory") ? "connected" : "needs_auth" },
				});
			}
			if (url.pathname === "/agent") {
				return json([
					{ name: "code", native: true, description: "Built-in coding agent" },
					{ name: "reviewer", native: false, description: "Reviews code" },
				]);
			}
			if (url.pathname === "/skill") {
				return json([
					{
						name: "pyscript-best-practices",
						location: "/home/user/.claude/skills/pyscript-best-practices/SKILL.md",
						description: "PyScript guidance",
					},
				]);
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		const harness = createFakeSdk({ featureId: "harness" });
		const mainSdk = createFakeMainSdk({
			featureId: "kilo-marketplace",
			services: harness.services,
			storageDir: "/storage",
			fetch,
		});
		const kiloServer = createFakeMainSdk({ featureId: "kilo-server", services: harness.services });
		const kiloUi = createFakeMainSdk({ featureId: "kilo-ui", services: harness.services });
		const connection = {
			baseUrl: "http://127.0.0.1:4321",
			username: "kilo",
			password: "secret",
			globalDirectory,
		};
		kiloServer.plugins.expose("connectionService", { getConnection: async () => connection });
		kiloServer.plugins.expose("kiloService", {
			mcpConfig: { list: async () => [{ id: "desktop", sourceId: "desktop" }] },
		});
		const workspaces = [
			{ id: "demo", name: "Demo", color: "#f00", folders: [{ path: demo, isPrimary: true }] },
			{ id: "docs", name: "Docs", folders: [{ path: docs, isPrimary: true }] },
		];
		kiloUi.plugins.expose("workspaceService", {
			list: async () => workspaces,
			get: async (id: string) => workspaces.find((workspace) => workspace.id === id) ?? null,
		});
		mainRegister(mainSdk);
		disposables.push(async () => {
			await Promise.all([mainSdk.disposeAsync(), kiloServer.disposeAsync(), kiloUi.disposeAsync()]);
			harness.destroy();
		});

		const listed = marketplaceSnapshotSchema.parse(
			await mainSdk.invoke("marketplace.list", { workspaceId: "demo" }),
		);
		expect(listed.targets).toEqual([
			{ id: "demo", name: "Demo", color: "#f00", directory: demo },
			{ id: "docs", name: "Docs", directory: docs },
		]);
		expect(listed.installed).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "mcp", id: "github", scope: "global" }),
				expect.objectContaining({
					type: "agent",
					id: "reviewer",
					scope: "workspace",
					workspaceId: "demo",
				}),
				expect.objectContaining({
					type: "mcp",
					id: "github",
					scope: "workspace",
					workspaceId: "docs",
				}),
			]),
		);
		expect(listed.installed.some((entry) => entry.id === "pyscript-best-practices")).toBe(false);
		expect(listed.included.some((entry) => entry.id === "pyscript-best-practices")).toBe(false);
		expect(listed.included).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ type: "agent", id: "code", installedIn: "Kilo" }),
				expect.objectContaining({ type: "mcp", id: "desktop", installedIn: "Anaconda Desktop" }),
			]),
		);
		expect(listed.mcpStatuses.github).toEqual({ status: "connected" });
		expect(listed.mcpInstallationStatuses).toMatchObject({
			"github:global": { status: "needs_auth" },
			"github:demo": { status: "connected" },
			"github:docs": { status: "connected" },
		});
		expect(
			requests
				.filter(({ url }) => url.pathname === "/kilocode/marketplace")
				.map(({ url }) => url.searchParams.get("directory")),
		).toEqual([demo, docs]);
		expect(requests.every(({ url }) => url.origin === connection.baseUrl)).toBe(true);

		requests.length = 0;
		const refreshed = marketplaceSnapshotSchema.parse(
			await mainSdk.invoke("marketplace.refresh", { workspaceId: "demo" }),
		);
		expect(refreshed.installed).toEqual(listed.installed);
		expect(requests.every(({ url }) => url.origin === connection.baseUrl)).toBe(true);

		await expect(
			mainSdk.invoke("marketplace.install", {
				item: { type: "mcp", id: "github" },
				scope: "workspace",
				workspaceId: "demo",
				method: "Remote",
				parameters: { URL: "https://mcp.example.com" },
			}),
		).resolves.toEqual({ ok: true, path: "/installed/github.json" });
		const install = requests.find(({ url }) => url.pathname === "/kilocode/marketplace/install")!;
		expect(install.url.searchParams.get("directory")).toBe(demo);
		expect(JSON.parse(String(install.init?.body))).toMatchObject({
			target: "project",
			item: { type: "mcp", id: "github", content: catalogItems[1]!.content },
			parameters: { URL: "https://mcp.example.com", __method: "Remote" },
		});

		await expect(
			mainSdk.invoke("marketplace.remove", {
				item: { type: "agent", id: "reviewer" },
				scope: "global",
			}),
		).resolves.toEqual({ ok: true });
		const remove = requests.find(({ url }) => url.pathname === "/kilocode/marketplace/remove")!;
		expect(remove.url.searchParams.get("directory")).toBe(globalDirectory);
		expect(JSON.parse(String(remove.init?.body))).toEqual({
			item: { type: "agent", id: "reviewer" },
			scope: "global",
		});

		await expect(
			mainSdk.invoke("marketplace.authenticateMcp", { id: "github", workspaceId: "demo" }),
		).resolves.toEqual({ ok: true });
		const auth = requests.find(({ url }) => url.pathname.includes("/auth/authenticate"))!;
		expect(auth.url.searchParams.get("directory")).toBe(demo);
		expect(auth.init?.headers).toMatchObject({
			authorization: `Basic ${Buffer.from("kilo:secret").toString("base64")}`,
		});
	});

	it("translates a CLI mutation failure into a business error", async () => {
		const harness = createFakeSdk({ featureId: "harness" });
		const fetch = vi.fn(async (input: string | URL | Request) => {
			const url = new URL(String(input));
			if (url.pathname === "/kilocode/marketplace/remove") {
				return json({ success: false, slug: "docs", error: "Config is read-only." });
			}
			throw new Error(`Unexpected request: ${url}`);
		});
		const mainSdk = createFakeMainSdk({
			featureId: "kilo-marketplace",
			services: harness.services,
			storageDir: "/storage",
			fetch,
		});
		const kiloServer = createFakeMainSdk({ featureId: "kilo-server", services: harness.services });
		kiloServer.plugins.expose("connectionService", {
			getConnection: async () => ({
				baseUrl: "http://127.0.0.1:4321",
				username: "kilo",
				password: "secret",
				globalDirectory: "/runtime",
			}),
		});
		kiloServer.plugins.expose("kiloService", { mcpConfig: {} });
		mainRegister(mainSdk);
		disposables.push(async () => {
			await Promise.all([mainSdk.disposeAsync(), kiloServer.disposeAsync()]);
			harness.destroy();
		});

		await expect(
			mainSdk.invoke("marketplace.remove", {
				item: { type: "mcp", id: "docs" },
				scope: "global",
			}),
		).rejects.toMatchObject({ code: "BUSINESS", message: "Config is read-only." });
	});
});
