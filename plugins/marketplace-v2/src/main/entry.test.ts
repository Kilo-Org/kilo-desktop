import { afterEach, describe, expect, it, vi } from "vitest";

import {
	definePlugin,
	KernelError,
	type KernelLogger,
	type PluginRegistration,
} from "@kilo-desktop/kernel";
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
import { Marketplace, MARKETPLACE_DEFINITIONS } from "../contracts/index";
import { FakeV2Marketplace } from "../test/fake-v2-marketplace";
import { createMarketplaceMainEntry } from "./entry";

const unused = () => {
	throw new KernelError("UNAVAILABLE", "Not in tests.");
};

const connection = {
	baseUrl: "http://127.0.0.1:4321",
	username: "kilo",
	password: "secret",
	version: "1",
	globalDirectory: "/runtime",
};

const demo: Workspace = {
	id: "demo",
	name: "Demo",
	color: "#f00",
	folders: [{ id: "folder-1", path: "/workspaces/demo", isPrimary: true, position: 0 }],
	createdAt: 1,
	updatedAt: 1,
};

/** Kilo v2 with an empty Marketplace, nothing installed and no agents, skills or MCPs. */
let kilo = new FakeV2Marketplace();
const apiFor = vi.fn((_connection: unknown) => kilo);

function recordingLogger() {
	const warnings: unknown[][] = [];
	const errors: unknown[][] = [];
	const logger: KernelLogger = {
		debug: () => {},
		info: () => {},
		warn: (...args) => void warnings.push(args),
		error: (...args) => void errors.push(args),
	};
	return { logger, warnings, errors };
}

/** The kernel reports kilo.marketplace's manifest contributions to absent plugins; the entry says nothing. */
const ownMessages = (messages: unknown[][]) =>
	messages.filter(([message]) => !String(message).startsWith("[kilo.marketplace] Contribution"));

const core = (connect: () => typeof connection): PluginRegistration => ({
	manifest: coreManifest,
	definitions: CORE_DEFINITIONS,
	entry: definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(KiloServer, {
				initialState: { status: "ready" },
				methods: { connect, restart: unused, disposeInstance: unused, userConfigFile: unused },
			});
		},
	}),
});

const workSessions: PluginRegistration = {
	manifest: workSessionsManifest,
	definitions: WORK_SESSIONS_DEFINITIONS,
	entry: definePlugin({
		activate(sdk) {
			sdk.domainObjects.provide(Workspaces, {
				initialState: { workspaces: [demo], activeId: null, unavailableFolderIds: [] },
				methods: new Proxy({}, { get: () => unused }) as never,
			});
		},
	}),
};

/**
 * MCP servers added to Kilo through `kilo.core/mcp-server`: a static one, a
 * dynamic one, one naming no command and a dynamic one currently adding nothing.
 */
const mcpContributor = testPlugin("acme.mcps", {
	manifest: {
		requires: { "kilo.core/mcp-server": "optional" },
		contributes: {
			extensions: {
				"kilo.core/mcp-server": [
					{ id: "static-mcp", command: "node", args: ["server.js"] },
					{ id: "dynamic-mcp" },
					{ id: "no-command" },
					{ id: "switched-off" },
				],
			},
		},
	},
	entry: definePlugin({
		activate(sdk) {
			sdk.extensions.implement(McpServer, "dynamic-mcp", {
				read: () => ({ type: "remote", url: "https://example.com/mcp" }),
			});
			sdk.extensions.implement(McpServer, "switched-off", { read: () => undefined });
		},
	}),
});

const kernels: { stop(): Promise<void> }[] = [];

afterEach(async () => {
	await Promise.all(kernels.splice(0).map((kernel) => kernel.stop()));
	kilo = new FakeV2Marketplace();
	apiFor.mockClear();
});

async function boot(main: PluginRegistration[], logger?: KernelLogger) {
	const pair = await createTestKernelPair({
		main: [
			...main,
			{
				manifest,
				definitions: MARKETPLACE_DEFINITIONS,
				entry: createMarketplaceMainEntry({ api: apiFor }),
			},
		],
		mainHostServices: (pluginId) =>
			pluginId === manifest.id
				? { net: { fetch: async () => new Response(null, { status: 500 }) } }
				: {},
		renderer: [{ manifest, definitions: MARKETPLACE_DEFINITIONS }],
		...(logger ? { logger } : {}),
	});
	kernels.push(pair.main);
	await pair.main.flush();
	return pair.main.kernelSdk.domainObjects.get(Marketplace)!;
}

describe("kilo.marketplace's main entry", () => {
	it("reaches Kilo's server through kilo.core and lists kilo.work-sessions' workspaces", async () => {
		const connect = vi.fn(() => connection);
		const marketplace = await boot([core(connect), workSessions]);

		const snapshot = await marketplace.methods.list({ workspaceId: "demo" });

		expect(connect).toHaveBeenCalled();
		expect(snapshot.targets).toEqual([
			{ id: "demo", name: "Demo", color: "#f00", directory: "/workspaces/demo" },
		]);
		expect(apiFor).toHaveBeenCalledWith(expect.objectContaining({ baseUrl: connection.baseUrl }));
		expect(kilo.callsTo("installed").map(([, directory]) => directory)).toEqual(
			expect.arrayContaining(["/runtime", "/workspaces/demo"]),
		);
	});

	it("shows the MCP servers kilo.core/mcp-server contributions add to Kilo as built in", async () => {
		const marketplace = await boot([core(() => connection), workSessions, mcpContributor]);

		const { included } = await marketplace.methods.list({});

		expect(included.filter((entry) => entry.type === "mcp").map((entry) => entry.id)).toEqual([
			"static-mcp",
			"dynamic-mcp",
		]);
		expect(included).toContainEqual(
			expect.objectContaining({ type: "mcp", id: "static-mcp", installedIn: "Anaconda Desktop" }),
		);
	});

	it("activates without kilo.core, kilo.work-sessions, kilo.chat and kilo.shell, logging nothing", async () => {
		const { logger, warnings, errors } = recordingLogger();
		const marketplace = await boot([], logger);

		expect(marketplace).toBeDefined();
		await expect(marketplace.methods.list({})).rejects.toMatchObject({
			code: "UNAVAILABLE",
			message: "Kilo Server is unavailable.",
		});
		expect(ownMessages(warnings)).toEqual([]);
		expect(errors).toEqual([]);
	});
});
