import { describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import {
	buildRuntMcpEntry,
	reconcileRuntMcpConfig,
	RUNT_MCP_ENTRY_NAME,
	type KiloMcpConfigService,
} from "./seed-runt-mcp.js";

describe("buildRuntMcpEntry", () => {
	it("points kilo at runt mcp with an explicit daemon socket", () => {
		expect(buildRuntMcpEntry("/opt/runt-nightly", "/tmp/runtimed.sock")).toEqual({
			type: "local",
			command: ["/opt/runt-nightly", "mcp", "--socket", "/tmp/runtimed.sock", "--no-show"],
			enabled: true,
		});
	});
});

describe("reconcileRuntMcpConfig", () => {
	it("persists the runt MCP entry through kilo-server ownership", async () => {
		const mcpConfig: KiloMcpConfigService = {
			set: vi.fn(async () => undefined),
			remove: vi.fn(async () => undefined),
		};

		const { mainSdk: notebookSdk, createMainSdk } = createLinkedFakeSdkPair({
			featureId: "notebook",
		});
		const kiloServerSdk = createMainSdk("kilo-server");
		kiloServerSdk.plugins.expose("kiloService", { mcpConfig });

		await reconcileRuntMcpConfig(notebookSdk, {
			socketPath: "/tmp/runtimed.sock",
			resolveRuntBinary: () => "/opt/runt-nightly",
		});

		expect(mcpConfig.set).toHaveBeenCalledWith(
			"notebook",
			RUNT_MCP_ENTRY_NAME,
			buildRuntMcpEntry("/opt/runt-nightly", "/tmp/runtimed.sock"),
		);
		expect(mcpConfig.remove).not.toHaveBeenCalled();
		notebookSdk.dispose();
		kiloServerSdk.dispose();
	});

	it("removes stale runt configuration when the CLI is not staged", async () => {
		const mcpConfig: KiloMcpConfigService = {
			set: vi.fn(async () => undefined),
			remove: vi.fn(async () => undefined),
		};
		const { mainSdk: notebookSdk, createMainSdk } = createLinkedFakeSdkPair({
			featureId: "notebook",
		});
		const kiloServerSdk = createMainSdk("kilo-server");
		kiloServerSdk.plugins.expose("kiloService", { mcpConfig });

		await reconcileRuntMcpConfig(notebookSdk, {
			socketPath: "/tmp/runtimed.sock",
			resolveRuntBinary: () => undefined,
		});

		expect(mcpConfig.remove).toHaveBeenCalledWith("notebook", RUNT_MCP_ENTRY_NAME);
		expect(mcpConfig.set).not.toHaveBeenCalled();
		notebookSdk.dispose();
		kiloServerSdk.dispose();
	});
});
