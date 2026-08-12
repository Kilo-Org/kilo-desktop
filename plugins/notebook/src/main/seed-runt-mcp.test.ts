import { describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@anaconda-agentic-desktop/testing";

import {
	buildRuntMcpEntry,
	registerRuntMcpSeed,
	RUNT_MCP_ENTRY_NAME,
	type KiloManagedMcpService,
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

describe("registerRuntMcpSeed", () => {
	it("registers a managed seed that writes the runt MCP entry", async () => {
		const seedEntry = vi.fn(async () => ({ kind: "written" as const, reason: "created" as const }));
		const registerSeed = vi.fn((seed: () => Promise<void>) => {
			void seed();
		});
		const managedMcpService: KiloManagedMcpService = {
			configDirectory: "/runtime/config/kilo",
			registerSeed,
			seedEntry,
		};

		const { mainSdk: notebookSdk, createMainSdk } = createLinkedFakeSdkPair({
			featureId: "notebook",
		});
		const kiloServerSdk = createMainSdk("kilo-server");
		kiloServerSdk.plugins.expose("managedMcpService", managedMcpService);

		registerRuntMcpSeed(notebookSdk, {
			socketPath: "/tmp/runtimed.sock",
			resolveRuntBinary: () => "/opt/runt-nightly",
		});

		expect(registerSeed).toHaveBeenCalledOnce();
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(seedEntry).toHaveBeenCalledWith({
			name: RUNT_MCP_ENTRY_NAME,
			entry: buildRuntMcpEntry("/opt/runt-nightly", "/tmp/runtimed.sock"),
			label: "notebook runt MCP",
		});
		notebookSdk.dispose();
		kiloServerSdk.dispose();
	});

	it("skips seeding when the runt CLI is not staged", async () => {
		const seedEntry = vi.fn();
		const registerSeed = vi.fn((seed: () => Promise<void>) => {
			void seed();
		});
		const { mainSdk: notebookSdk, createMainSdk } = createLinkedFakeSdkPair({
			featureId: "notebook",
		});
		const kiloServerSdk = createMainSdk("kilo-server");
		kiloServerSdk.plugins.expose("managedMcpService", {
			configDirectory: "/runtime/config/kilo",
			registerSeed,
			seedEntry,
		});

		registerRuntMcpSeed(notebookSdk, {
			socketPath: "/tmp/runtimed.sock",
			resolveRuntBinary: () => undefined,
		});

		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(seedEntry).not.toHaveBeenCalled();
		notebookSdk.dispose();
		kiloServerSdk.dispose();
	});
});
