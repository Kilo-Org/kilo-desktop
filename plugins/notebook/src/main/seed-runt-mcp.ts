import { existsSync } from "node:fs";

import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { findRuntArtifact } from "./distribution/artifacts.js";

export const RUNT_MCP_ENTRY_NAME = "runt";

/** Structural capability shape from kilo-server — asserted, not imported. */
export type KiloManagedMcpService = {
	readonly configDirectory: string;
	registerSeed(seed: () => Promise<void>): void;
	seedEntry(options: {
		readonly name: string;
		readonly entry?: {
			readonly type: "local";
			readonly command: readonly [string, ...string[]];
			readonly environment?: Readonly<Record<string, string>>;
			readonly enabled: true;
		};
		readonly enabled?: boolean;
		readonly label?: string;
	}): Promise<unknown>;
};

export type KiloServerManagedMcpCapabilities = {
	managedMcpService: KiloManagedMcpService;
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
 * Registers a managed `mcp["runt"]` seed with kilo-server so `kilo serve`
 * sees `runt mcp` before it boots. No-ops when the CLI is not staged for
 * this platform or kilo-server is inactive.
 */
export function registerRuntMcpSeed(mainSdk: MainSdk, options: SeedRuntMcpOptions): void {
	const logger = options.logger ?? mainSdk.logger;
	const managedMcp =
		mainSdk.plugins.get<KiloServerManagedMcpCapabilities>("kilo-server")?.managedMcpService;
	if (!managedMcp) {
		logger.warn("Skipping runt MCP seed: kilo-server managedMcpService is unavailable.");
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

	managedMcp.registerSeed(async () => {
		const runtBinary = resolveRuntBinary();
		if (!runtBinary) {
			logger.info("Skipping runt MCP seed: runt CLI is not staged for this platform.");
			return;
		}
		await managedMcp.seedEntry({
			name: RUNT_MCP_ENTRY_NAME,
			entry: buildRuntMcpEntry(runtBinary, options.socketPath),
			label: "notebook runt MCP",
		});
	});
}
