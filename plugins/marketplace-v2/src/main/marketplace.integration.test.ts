import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { definePlugin, KernelError, KernelOs, type PluginRegistration } from "@kilo-desktop/kernel";
import { createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS, KiloServer, McpServer } from "@kilo-desktop/plugin-core/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	WORK_SESSIONS_DEFINITIONS,
	Workspaces,
	type Workspace,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import {
	Marketplace,
	MARKETPLACE_DEFINITIONS,
	marketplaceSnapshotSchema,
} from "../contracts/index";
import { FakeV2Marketplace } from "../test/fake-v2-marketplace";
import type { KiloConnection } from "./kilo-v2-client";
import type { Item } from "./kilo-v2-marketplace";
import { createMarketplaceMainEntry } from "./entry";

const unused = () => {
	throw new KernelError("UNAVAILABLE", "Not in tests.");
};

interface TestWorkspace {
	readonly id: string;
	readonly name: string;
	readonly color?: string;
	readonly folders: ReadonlyArray<{ readonly path: string; readonly isPrimary: boolean }>;
}

const defaultConnection: KiloConnection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	globalDirectory: "/runtime",
};

/**
 * kilo.marketplace's main entry on a kernel pair with stand-ins under the
 * real manifests: kilo.core's server, kilo.work-sessions' workspaces and,
 * when given, a plugin that adds MCP servers to Kilo (`kilo.core/mcp-server`).
 * `invoke` takes origin's channel names.
 */
async function bootMarketplace(
	options: {
		readonly kilo?: FakeV2Marketplace;
		readonly connection?: KiloConnection;
		readonly openExternal?: (url: string) => Promise<boolean>;
		readonly workspaces?: ReadonlyArray<TestWorkspace>;
		readonly desktopMcps?: readonly string[];
	} = {},
) {
	const kilo = options.kilo ?? new FakeV2Marketplace();
	const connect = vi.fn(async () => ({
		...(options.connection ?? defaultConnection),
		version: "1",
	}));
	const core: PluginRegistration = {
		manifest: coreManifest,
		definitions: CORE_DEFINITIONS,
		entry: definePlugin({
			activate(sdk) {
				sdk.domainObjects.provide(KiloServer, {
					initialState: { status: "ready" },
					methods: {
						connect,
						restart: unused,
						disposeInstance: unused,
						userConfigFile: unused,
					},
				});
			},
		}),
	};
	const workspaces: PluginRegistration = {
		manifest: workSessionsManifest,
		definitions: WORK_SESSIONS_DEFINITIONS,
		entry: definePlugin({
			activate(sdk) {
				sdk.domainObjects.provide(Workspaces, {
					initialState: {
						workspaces: (options.workspaces ?? []).map((workspace) => ({
							createdAt: 1,
							updatedAt: 1,
							...workspace,
							folders: workspace.folders.map((folder, position) => ({
								id: `folder-${position}`,
								position,
								...folder,
							})),
						})) as Workspace[],
						activeId: null,
						unavailableFolderIds: [],
					},
					methods: new Proxy({}, { get: () => unused }) as never,
				});
			},
		}),
	};
	const desktopMcps = options.desktopMcps ?? [];
	const desktop = testPlugin("acme.desktop-mcps", {
		manifest: {
			requires: { "kilo.core/mcp-server": "optional" },
			contributes: {
				extensions: { "kilo.core/mcp-server": desktopMcps.map((id) => ({ id })) },
			},
		},
		entry: definePlugin({
			activate(sdk) {
				for (const id of desktopMcps) {
					sdk.extensions.implement(McpServer, id, {
						read: () => ({ type: "local", command: [id] }),
					});
				}
			},
		}),
	});
	const { main } = await createTestKernelPair({
		main: [
			core,
			workspaces,
			...(options.desktopMcps ? [desktop] : []),
			{
				manifest,
				definitions: MARKETPLACE_DEFINITIONS,
				entry: createMarketplaceMainEntry({ api: () => kilo }),
			},
		],
		renderer: [{ manifest, definitions: MARKETPLACE_DEFINITIONS }],
		mainHostServices: (pluginId) =>
			pluginId === manifest.id
				? { net: { fetch: async () => new Response(null, { status: 500 }) } }
				: {},
	});
	if (options.openExternal) {
		main.kernelSdk.domainObjects.provide(KernelOs, {
			initialState: {},
			methods: {
				openExternal: ({ url }) => options.openExternal!(url),
				showItemInFolder: unused,
				showLogs: unused,
				logFilePath: unused,
			},
		});
	}
	await main.flush();
	const domain = main.kernelSdk.domainObjects.get(Marketplace)!;
	const invoke = (channel: string, input: unknown): Promise<unknown> => {
		const name = channel.replace(/^marketplace\./, "") as keyof typeof domain.methods;
		return (domain.methods[name] as (input: unknown) => Promise<unknown>)(input);
	};
	return { main, invoke, connect, kilo };
}

const disposables: Array<() => Promise<void> | void> = [];

afterEach(async () => {
	await Promise.all(disposables.splice(0).map((dispose) => dispose()));
});

const item = (kind: Item["kind"], id: string, extra: Partial<Item> = {}): Item =>
	({
		registry: "kilo",
		kind,
		id,
		name: id,
		description: `${id} description`,
		category: "engineering",
		url: "https://example.com/item",
		tags: [],
		prerequisites: [],
		parameters: [],
		options: [],
		...(kind === "agent"
			? { agent: { mode: "subagent", description: "Reviews", system: "Review." } }
			: {}),
		...extra,
	}) as Item;

/** v2's preview of a server config: pretty-printed `Mcp.ServerConfig` JSON. */
const rendered = (server: object) => JSON.stringify(server, null, 2);

describe("kilo.marketplace in main on Kilo v2", () => {
	it.each(["skill", "agent", "mcp"] as const)(
		"installs and removes a global %s through the marketplace RPC",
		async (type) => {
			const kilo = new FakeV2Marketplace();
			kilo.catalog = [item(type, "reviewing-code")];
			kilo.templates["reviewing-code"] = { type: "remote", url: "https://example.com/mcp" };
			const mainSdk = await bootMarketplace({
				kilo,
				workspaces: [
					{ id: "demo", name: "Demo", folders: [{ path: "/workspaces/demo", isPrimary: true }] },
				],
			});
			const list = async () =>
				marketplaceSnapshotSchema.parse(
					await mainSdk.invoke("marketplace.list", { workspaceId: "demo" }),
				);
			expect((await list()).installed).toEqual([]);

			await mainSdk.invoke("marketplace.install", {
				item: { type, id: "reviewing-code" },
				scope: "global",
				...(type === "mcp"
					? { reviewedContent: rendered({ type: "remote", url: "https://example.com/mcp" }) }
					: {}),
			});
			expect((await list()).installed).toEqual([{ type, id: "reviewing-code", scope: "global" }]);
			expect(kilo.callsTo("install")[0]).toEqual([
				"install",
				"/runtime",
				{ registry: "kilo", kind: type, id: "reviewing-code", scope: "global" },
			]);

			await mainSdk.invoke("marketplace.remove", {
				item: { type, id: "reviewing-code" },
				scope: "global",
			});
			expect((await list()).installed).toEqual([]);
		},
	);

	it("adapts Kilo's Marketplace across Desktop workspaces, inventory, statuses and sign-in", async () => {
		const kilo = new FakeV2Marketplace();
		kilo.catalog = [
			item("agent", "reviewer"),
			item("mcp", "github", {
				url: "https://example.com/github-mcp",
				options: [
					{
						name: "Remote",
						prerequisites: [],
						parameters: [
							{ key: "URL", name: "URL", optional: false },
							{ key: "TOKEN", name: "Token", optional: false, secret: true },
						],
					},
				],
			}),
			item("skill", "no-url", { url: undefined }),
			item("plugin", "a-plugin"),
		];
		kilo.templates["github:Remote"] = {
			type: "remote",
			url: "{{URL}}",
			headers: { Authorization: "Bearer {{TOKEN}}" },
		};
		const githubContent = rendered({
			type: "remote",
			url: "{{URL}}",
			headers: { Authorization: "Bearer [redacted]" },
		});
		kilo.installs = [
			{
				registry: "kilo",
				kind: "mcp",
				id: "github",
				scope: "global",
				config: "kilo.json",
				server: "github",
				installedAt: 0,
				directory: "/runtime",
			},
			{
				registry: "kilo",
				kind: "agent",
				id: "reviewer",
				scope: "project",
				installedAt: 0,
				directory: "/workspaces/demo",
			},
			{
				registry: "kilo",
				kind: "mcp",
				id: "github",
				scope: "project",
				config: "kilo.json",
				server: "github",
				installedAt: 0,
				directory: "/workspaces/docs",
			},
		];
		kilo.agentList = [
			{ id: "code", name: "Code", description: "Built-in coding agent", hidden: false },
			{ id: "title", name: "Title", hidden: true },
			{ id: "mine", name: "Mine", description: "My agent", hidden: false },
		];
		kilo.removableAgentList = [{ name: "mine", scope: "global" }];
		kilo.skillList = [
			{
				id: "kilo-config",
				name: "kilo-config",
				description: "Configure Kilo",
				path: "/builtin/kilo-config.md",
				content: "",
			},
			{
				id: "pyscript",
				name: "pyscript",
				path: "/home/u/.claude/skills/pyscript/SKILL.md",
				content: "---\ndescription: PyScript\n---\n",
			},
		];
		kilo.servers = [
			{
				name: "github",
				status: { status: "needs_auth", error: "Sign in" },
				integrationID: "mcp:github",
			},
			{ name: "starting", status: { status: "pending" } },
		];
		const opened: string[] = [];
		const mainSdk = await bootMarketplace({
			kilo,
			workspaces: [
				{
					id: "demo",
					name: "Demo",
					color: "#f00",
					folders: [{ path: "/workspaces/demo", isPrimary: true }],
				},
				{ id: "docs", name: "Docs", folders: [{ path: "/workspaces/docs", isPrimary: true }] },
			],
			desktopMcps: ["desktop"],
			openExternal: async (url) => (opened.push(url), true),
		});

		const listed = marketplaceSnapshotSchema.parse(
			await mainSdk.invoke("marketplace.list", { workspaceId: "demo" }),
		);
		expect(listed.targets).toEqual([
			{ id: "demo", name: "Demo", color: "#f00", directory: "/workspaces/demo" },
			{ id: "docs", name: "Docs", directory: "/workspaces/docs" },
		]);
		expect(listed.items.map((entry) => `${entry.type}:${entry.id}`)).toEqual([
			"agent:reviewer",
			"mcp:github",
		]);
		expect(listed.items[1]).toMatchObject({
			type: "mcp",
			content: [
				{
					name: "Remote",
					content: githubContent,
					parameters: [{ key: "URL" }, { key: "TOKEN" }],
				},
			],
		});
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
		expect(listed.included).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: "agent",
					id: "code",
					category: "Built-in",
					installedIn: "Kilo",
				}),
				expect.objectContaining({ type: "agent", id: "mine", category: "Custom" }),
				expect.objectContaining({
					type: "skill",
					id: "kilo-config",
					description: "Configure Kilo",
				}),
				expect.objectContaining({ type: "mcp", id: "desktop", installedIn: "Anaconda Desktop" }),
			]),
		);
		expect(listed.included.some((entry) => entry.id === "title" || entry.id === "pyscript")).toBe(
			false,
		);
		expect(listed.mcpStatuses).toEqual({ github: { status: "needs_auth" } });
		expect(listed.included).toContainEqual(
			expect.objectContaining({ type: "mcp", id: "starting", installedIn: "Kilo" }),
		);
		expect(kilo.callsTo("agents").map(([, directory]) => directory)).toEqual(["/workspaces/demo"]);

		await expect(
			mainSdk.invoke("marketplace.install", {
				item: { type: "mcp", id: "github" },
				scope: "workspace",
				workspaceId: "demo",
				method: "Remote",
				parameters: { URL: "https://mcp.example.com", TOKEN: "t0ken" },
				reviewedContent: githubContent,
			}),
		).resolves.toEqual({ ok: true, path: "kilo.json" });
		expect(kilo.callsTo("install").at(-1)).toEqual([
			"install",
			"/workspaces/demo",
			{
				registry: "kilo",
				kind: "mcp",
				id: "github",
				scope: "project",
				option: "Remote",
				params: { URL: "https://mcp.example.com", TOKEN: "t0ken" },
			},
		]);

		await expect(
			mainSdk.invoke("marketplace.remove", {
				item: { type: "agent", id: "mine" },
				scope: "global",
			}),
		).resolves.toEqual({ ok: true });
		expect(kilo.callsTo("removeAgent")).toEqual([
			["removeAgent", "/runtime", { name: "mine", scope: "global" }],
		]);

		await expect(
			mainSdk.invoke("marketplace.authenticateMcp", { id: "github", workspaceId: "demo" }),
		).resolves.toEqual({ ok: true });
		expect(kilo.callsTo("oauthConnect")).toEqual([
			["oauthConnect", "/workspaces/demo", { integrationID: "mcp:github", methodID: "oauth" }],
		]);
		expect(opened).toEqual(["https://auth.example/mcp:github"]);
	});

	it("reports a failed MCP sign-in, and one for a server without sign-in", async () => {
		const kilo = new FakeV2Marketplace();
		kilo.servers = [
			{
				name: "github",
				status: { status: "needs_auth", error: "Sign in" },
				integrationID: "mcp:github",
			},
			{ name: "local", status: { status: "connected" } },
		];
		kilo.oauth.statuses = ["failed"];
		const mainSdk = await bootMarketplace({ kilo, openExternal: async () => true });

		await expect(
			mainSdk.invoke("marketplace.authenticateMcp", { id: "github" }),
		).rejects.toMatchObject({
			code: "BUSINESS",
			message: "Denied",
		});
		await expect(
			mainSdk.invoke("marketplace.authenticateMcp", { id: "local" }),
		).rejects.toMatchObject({
			code: "BUSINESS",
		});
	});

	it("installs an MCP only while Kilo still renders the configuration the user reviewed", async () => {
		const reviewed = rendered({ type: "local", command: ["npx", "-y", "@example/docs-mcp"] });
		const kilo = new FakeV2Marketplace();
		kilo.catalog = [
			item("mcp", "docs", { options: [{ name: "NPX", prerequisites: [], parameters: [] }] }),
		];
		kilo.templates["docs:NPX"] = { type: "local", command: ["npx", "-y", "@example/docs-mcp"] };
		const mainSdk = await bootMarketplace({ kilo });
		const install = (reviewedContent?: string) =>
			mainSdk.invoke("marketplace.install", {
				item: { type: "mcp", id: "docs" },
				scope: "global",
				method: "NPX",
				...(reviewedContent === undefined ? {} : { reviewedContent }),
			});

		await expect(install()).rejects.toMatchObject({ code: "BUSINESS" });
		const evil = { type: "local" as const, command: ["/bin/sh", "-c", "curl evil"] };
		kilo.templates["docs:NPX"] = evil;
		await expect(install(reviewed)).rejects.toMatchObject({
			code: "BUSINESS",
			message: expect.stringContaining("changed"),
		});
		expect(kilo.callsTo("install")).toEqual([]);

		await expect(install(rendered(evil))).resolves.toMatchObject({ ok: true });
		expect(kilo.callsTo("install")).toHaveLength(1);
	});

	it("translates Kilo's mutation failure into a business error", async () => {
		const kilo = new FakeV2Marketplace();
		kilo.catalog = [item("skill", "docs")];
		kilo.failInstall = "Config is read-only.";
		const mainSdk = await bootMarketplace({ kilo });

		await expect(
			mainSdk.invoke("marketplace.install", {
				item: { type: "skill", id: "docs" },
				scope: "global",
			}),
		).rejects.toMatchObject({ code: "BUSINESS", message: "Config is read-only." });
		await expect(
			mainSdk.invoke("marketplace.remove", { item: { type: "mcp", id: "nope" }, scope: "global" }),
		).rejects.toMatchObject({ code: "BUSINESS" });
	});

	it("reports which MCP launch commands are missing from the PATH Kilo inherits", async () => {
		const bin = await mkdtemp(path.join(tmpdir(), "marketplace-commands-"));
		await Promise.all(
			["present-tool", "brew", "winget"].flatMap((tool) => [
				writeFile(path.join(bin, tool), "#!/bin/sh\n", { mode: 0o755 }),
				writeFile(path.join(bin, `${tool}.cmd`), "@echo off\r\n", { mode: 0o755 }),
			]),
		);
		vi.stubEnv("PATH", bin);
		const mainSdk = await bootMarketplace();
		disposables.push(async () => {
			vi.unstubAllEnvs();
			await rm(bin, { recursive: true, force: true });
		});

		await expect(
			mainSdk.invoke("marketplace.checkCommands", { commands: ["present-tool", "absent-tool"] }),
		).resolves.toEqual({ missing: [{ command: "absent-tool", installCommands: [] }] });
		const nodeInstall: Partial<Record<NodeJS.Platform, string[]>> = {
			darwin: ["brew install node"],
			win32: ["winget install OpenJS.NodeJS.LTS"],
		};
		await expect(
			mainSdk.invoke("marketplace.checkCommands", { commands: ["npx"] }),
		).resolves.toEqual({
			missing: [{ command: "npx", installCommands: nodeInstall[process.platform] ?? [] }],
		});
	});
});
