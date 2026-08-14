import { existsSync } from "node:fs";

import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { findRuntArtifact } from "./distribution/artifacts.js";

export const RUNT_MCP_ENTRY_NAME = "runt";

/** Structural capability shape from kilo-server — asserted, not imported. */
export type KiloMcpConfigService = {
	set(sourceId: string, entryId: string, entry: Readonly<Record<string, unknown>>): Promise<void>;
	remove(sourceId: string, entryId: string): Promise<void>;
};

export type KiloServerMcpCapabilities = {
	kiloService: {
		mcpConfig: KiloMcpConfigService;
	};
};

export interface SeedRuntMcpOptions {
	readonly resolveRuntBinary?: () => string | undefined;
	readonly socketPath: string;
	readonly logger?: Pick<MainSdk["logger"], "info" | "warn">;
}

export function buildRuntMcpEntry(
	runtBinaryPath: string,
	socketPath: string,
): {
	readonly type: "local";
	readonly command: readonly [string, string, string, string, string];
	readonly enabled: true;
} {
	return {
		type: "local",
		command: [runtBinaryPath, "mcp", "--socket", socketPath, "--no-show"],
		enabled: true,
	};
}

/**
 * Reconciles Desktop's owned `mcp["runt"]` entry through kilo-server before
 * the notebook feature finishes booting. A missing staged CLI removes any
 * stale owned entry; an inactive kilo-server leaves configuration untouched.
 */
export async function reconcileRuntMcpConfig(
	mainSdk: MainSdk,
	options: SeedRuntMcpOptions,
): Promise<void> {
	const logger = options.logger ?? mainSdk.logger;
	const mcpConfig =
		mainSdk.plugins.get<KiloServerMcpCapabilities>("kilo-server")?.kiloService.mcpConfig;
	if (!mcpConfig) {
		logger.warn("Skipping runt MCP configuration: kilo-server mcpConfig is unavailable.");
		return;
	}

	const resolveRuntBinary =
		options.resolveRuntBinary ??
		(() => {
			const artifact = findRuntArtifact();
			if (!artifact) return undefined;
			const candidate = mainSdk.resolvePluginAsset(
				`resources/runt/${artifact.target}/${artifact.executable}`,
			);
			return existsSync(candidate) ? candidate : undefined;
		});

	const runtBinary = resolveRuntBinary();
	if (!runtBinary) {
		await mcpConfig.remove("notebook", RUNT_MCP_ENTRY_NAME);
		logger.info("Removed runt MCP configuration because the runt CLI is not staged.");
		return;
	}

	await mcpConfig.set(
		"notebook",
		RUNT_MCP_ENTRY_NAME,
		buildRuntMcpEntry(runtBinary, options.socketPath),
	);
}
