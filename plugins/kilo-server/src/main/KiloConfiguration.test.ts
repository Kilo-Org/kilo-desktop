import { describe, expect, it, vi } from "vitest";

import { KiloConfiguration } from "./KiloConfiguration.js";

import type { KiloConfigMutationOutcome } from "./KiloConfigManager.js";
import type { KiloPluginMutationOutcome } from "./KiloPluginConfig.js";

describe("KiloConfiguration", () => {
	it("reconciles desired state by adding first, pruning source-owned leftovers, and requesting one restart", async () => {
		const operations: string[] = [];
		const onChanged = vi.fn();
		const configuration = new KiloConfiguration({
			mcpConfig: {
				setMcpEntry: vi.fn(async (): Promise<KiloConfigMutationOutcome> => {
					operations.push("set-mcp");
					return { kind: "written", reason: "updated" };
				}),
				removeMcpEntry: vi.fn(async (): Promise<KiloConfigMutationOutcome> => {
					operations.push("remove-mcp");
					return { kind: "removed", reason: "explicit" };
				}),
				listOwnedMcpEntryIds: vi.fn(async () => {
					operations.push("list-mcp");
					return ["replacement", "legacy"];
				}),
			},
			pluginConfig: {
				install: vi.fn(async (): Promise<KiloPluginMutationOutcome> => {
					operations.push("install-plugin");
					return { kind: "written", reason: "created" };
				}),
				remove: vi.fn(async (): Promise<KiloPluginMutationOutcome> => {
					operations.push("remove-plugin");
					return { kind: "removed", reason: "explicit" };
				}),
				listOwnedPluginIds: vi.fn(async () => {
					operations.push("list-plugin");
					return ["notebooks", "legacy"];
				}),
			},
			onChanged,
		});

		await configuration.set("notebook", {
			plugins: { notebooks: "/plugins/notebooks.js" },
			mcpEntries: { replacement: { type: "local", command: ["node"] } },
		});

		expect(operations).toEqual([
			"install-plugin",
			"set-mcp",
			"list-mcp",
			"remove-mcp",
			"list-plugin",
			"remove-plugin",
		]);
		expect(onChanged).toHaveBeenCalledOnce();
	});

	it("rejects pruning an MCP entry that is no longer owned by the source", async () => {
		const configuration = new KiloConfiguration({
			mcpConfig: {
				setMcpEntry: vi.fn(),
				removeMcpEntry: vi.fn(async (): Promise<KiloConfigMutationOutcome> => ({
					kind: "skipped",
					reason: "entry-not-owned",
				})),
				listOwnedMcpEntryIds: vi.fn(async () => ["stale"]),
			},
			pluginConfig: {
				install: vi.fn(),
				remove: vi.fn(),
				listOwnedPluginIds: vi.fn(async () => []),
			},
			onChanged: vi.fn(),
		});

		await expect(configuration.set("notebook", { plugins: {}, mcpEntries: {} })).rejects.toThrow(
			'Could not remove Desktop-owned MCP "stale": it is not owned by "notebook".',
		);
	});
});
