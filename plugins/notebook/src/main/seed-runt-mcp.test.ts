import { describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import {
	buildNteractMcpEntry,
	buildRuntMcpEntry,
	NTERACT_MCP_ENTRY_NAME,
	reconcileRuntMcpConfig,
	type KiloMcpConfigService,
} from "./seed-runt-mcp.js";

describe("notebook MCP entries", () => {
	it("points kilo at the resilient proxy with the pinned channel", () => {
		expect(buildNteractMcpEntry("/opt/nteract-mcp", "nightly")).toEqual({
			type: "local",
			command: ["/opt/nteract-mcp"],
			environment: { NTERACT_CHANNEL: "nightly" },
			enabled: true,
		});
	});

	it("points kilo at runt mcp with an explicit daemon socket", () => {
		expect(buildRuntMcpEntry("/opt/runt-nightly", "/tmp/runtimed.sock")).toEqual({
			type: "local",
			command: ["/opt/runt-nightly", "mcp", "--socket", "/tmp/runtimed.sock", "--no-show"],
			enabled: true,
		});
	});
});

describe("reconcileRuntMcpConfig", () => {
	it("persists nteract-mcp through kilo-server ownership", async () => {
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
			runtimeChannel: "nightly",
			resolveNteractMcpBinary: () => "/opt/nteract-mcp",
			resolveRuntBinary: () => "/opt/runt-nightly",
		});

		expect(mcpConfig.set).toHaveBeenCalledWith(
			"notebook",
			NTERACT_MCP_ENTRY_NAME,
			buildNteractMcpEntry("/opt/nteract-mcp", "nightly"),
		);
		expect(mcpConfig.remove).toHaveBeenCalledWith("notebook", "runt");
		expect(mcpConfig.remove).not.toHaveBeenCalledWith("notebook", NTERACT_MCP_ENTRY_NAME);
		notebookSdk.dispose();
		kiloServerSdk.dispose();
	});

	it("uses direct runt only for an explicit custom daemon socket", async () => {
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
			runtimeChannel: "nightly",
			customSocketPath: "/tmp/runtimed.sock",
			resolveNteractMcpBinary: () => "/opt/nteract-mcp",
			resolveRuntBinary: () => "/opt/runt-nightly",
		});

		expect(mcpConfig.set).toHaveBeenCalledWith(
			"notebook",
			NTERACT_MCP_ENTRY_NAME,
			buildRuntMcpEntry("/opt/runt-nightly", "/tmp/runtimed.sock"),
		);
		expect(mcpConfig.remove).toHaveBeenCalledWith("notebook", "runt");
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
			runtimeChannel: "nightly",
			resolveNteractMcpBinary: () => undefined,
		});

		expect(mcpConfig.remove).toHaveBeenCalledWith("notebook", "runt");
		expect(mcpConfig.remove).toHaveBeenCalledWith("notebook", NTERACT_MCP_ENTRY_NAME);
		expect(mcpConfig.set).not.toHaveBeenCalled();
		notebookSdk.dispose();
		kiloServerSdk.dispose();
	});

	it("does not let nteract-mcp fall back to a runt installation on PATH", async () => {
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
			runtimeChannel: "nightly",
			resolveNteractMcpBinary: () => "/opt/nteract-mcp",
			resolveRuntBinary: () => undefined,
		});

		expect(mcpConfig.remove).toHaveBeenCalledWith("notebook", "runt");
		expect(mcpConfig.remove).toHaveBeenCalledWith("notebook", NTERACT_MCP_ENTRY_NAME);
		expect(mcpConfig.set).not.toHaveBeenCalled();
		notebookSdk.dispose();
		kiloServerSdk.dispose();
	});
});
