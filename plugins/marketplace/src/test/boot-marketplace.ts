// kilo.marketplace's main entry on a kernel pair, with stand-ins under the real
// manifests for kilo.core's server, kilo.work-sessions' workspaces, the
// kernel's os and, when given, a plugin that adds MCP servers to Kilo
// (`kilo.core/mcp-server`). Requests to Kilo go to `fetch` (an in-memory v2
// fake, or the real kilo2's address).
import { vi } from "vitest";

import {
	definePlugin,
	KernelError,
	KernelOs,
	type KernelLogger,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
import { createTestKernelPair, testPlugin } from "@kilo-desktop/kernel/testing";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	CORE_DEFINITIONS,
	KiloServer,
	McpServer,
	type ServerConnection,
} from "@kilo-desktop/plugin-core/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import {
	WORK_SESSIONS_DEFINITIONS,
	Workspaces,
	type Workspace,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import { Marketplace, MARKETPLACE_DEFINITIONS } from "../contracts/index";
import { createMarketplaceMainEntry, type MarketplaceMainOptions } from "../main/entry";
import { FAKE_KILO2_BASE_URL, GLOBAL_DIRECTORY } from "./fake-kilo2-marketplace";

const unused = () => {
	throw new KernelError("UNAVAILABLE", "Not in tests.");
};

export interface TestWorkspace {
	readonly id: string;
	readonly name: string;
	readonly color?: string;
	readonly folders: ReadonlyArray<{ readonly path: string; readonly isPrimary: boolean }>;
}

export const fakeConnection: ServerConnection = {
	baseUrl: FAKE_KILO2_BASE_URL,
	username: "opencode",
	password: "secret",
	version: "0.0.0-v2-239",
	globalDirectory: GLOBAL_DIRECTORY,
};

export interface BootOptions {
	readonly fetch: typeof globalThis.fetch;
	readonly connection?: ServerConnection;
	/** Boots without kilo.core and kilo.work-sessions. */
	readonly bare?: boolean;
	readonly workspaces?: ReadonlyArray<TestWorkspace>;
	readonly desktopMcps?: ReadonlyArray<{ readonly id: string; readonly command?: string }>;
	/** Dynamic `kilo.core/mcp-server` contributions: what each one currently adds (undefined: nothing). */
	readonly dynamicMcps?: Readonly<Record<string, object | undefined>>;
	/** Whether the kernel's os opens a URL (true by default). */
	readonly openExternal?: boolean;
	readonly logger?: KernelLogger;
	readonly options?: MarketplaceMainOptions;
}

export async function bootMarketplace(options: BootOptions) {
	const connect = vi.fn(async () => options.connection ?? fakeConnection);
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
	const workSessions: PluginRegistration = {
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
	const staticMcps = options.desktopMcps ?? [];
	const dynamicMcps = options.dynamicMcps ?? {};
	const desktop = testPlugin("acme.desktop-mcps", {
		manifest: {
			requires: { "kilo.core/mcp-server": "optional" },
			contributes: {
				extensions: {
					"kilo.core/mcp-server": [
						...staticMcps.map(({ id, command }) => ({ id, ...(command ? { command } : {}) })),
						...Object.keys(dynamicMcps).map((id) => ({ id })),
					],
				},
			},
		},
		entry: definePlugin({
			activate(sdk) {
				for (const [id, entry] of Object.entries(dynamicMcps)) {
					sdk.extensions.implement(McpServer, id, { read: () => entry as never });
				}
			},
		}),
	});
	const opened: string[] = [];
	const { main } = await createTestKernelPair({
		main: [
			...(options.bare ? [] : [core, workSessions]),
			...(options.desktopMcps || options.dynamicMcps ? [desktop] : []),
			{
				manifest,
				definitions: MARKETPLACE_DEFINITIONS,
				entry: createMarketplaceMainEntry(options.options),
			},
		],
		renderer: [{ manifest, definitions: MARKETPLACE_DEFINITIONS }],
		mainHostServices: (pluginId) =>
			pluginId === manifest.id ? { net: { fetch: options.fetch } } : {},
		...(options.logger ? { logger: options.logger } : {}),
	});
	main.kernelSdk.domainObjects.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal: async ({ url }: { url: string }) => {
				opened.push(url);
				return options.openExternal ?? true;
			},
		} as never,
	});
	await main.flush();
	const marketplace = main.kernelSdk.domainObjects.get(Marketplace)!;
	return { main, marketplace: marketplace.methods, connect, opened };
}
