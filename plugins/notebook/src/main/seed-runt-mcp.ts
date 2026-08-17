import { existsSync } from "node:fs";

import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { findNteractMcpArtifact } from "./distribution/artifacts.js";
import type { BuildChannel } from "./socket-path.js";

export const NTERACT_MCP_ENTRY_NAME = "nteract-mcp";
/** Previous Kilo MCP id; dropped so tool prefixes are `nteract-mcp_*`, not `runt_*`. */
const LEGACY_RUNT_MCP_ENTRY_NAME = "runt";

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
	readonly resolveNteractMcpBinary?: () => string | undefined;
	readonly resolveRuntBinary?: () => string | undefined;
	readonly runtimeChannel: BuildChannel;
	readonly customSocketPath?: string;
	readonly logger?: Pick<MainSdk["logger"], "info" | "warn">;
}

export function buildNteractMcpEntry(
	nteractMcpBinaryPath: string,
	runtimeChannel: BuildChannel,
): {
	readonly type: "local";
	readonly command: readonly [string];
	readonly environment: Readonly<{ NTERACT_CHANNEL: BuildChannel }>;
	readonly enabled: true;
} {
	return {
		type: "local",
		command: [nteractMcpBinaryPath],
		environment: { NTERACT_CHANNEL: runtimeChannel },
		enabled: true,
	};
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
 * Reconciles Desktop's owned notebook MCP entry through kilo-server before
 * the feature finishes booting. Production uses nteract's resilient proxy;
 * an explicit custom socket uses direct `runt mcp` because the proxy
 * intentionally accepts only the channel-scoped canonical daemon endpoint.
 */
export async function reconcileRuntMcpConfig(
	mainSdk: MainSdk,
	options: SeedRuntMcpOptions,
): Promise<void> {
	const logger = options.logger ?? mainSdk.logger;
	const mcpConfig =
		mainSdk.plugins.get<KiloServerMcpCapabilities>("kilo-server")?.kiloService.mcpConfig;
	if (!mcpConfig) {
		logger.warn("Skipping nteract-mcp configuration: kilo-server mcpConfig is unavailable.");
		return;
	}

	const artifact = findNteractMcpArtifact();
	const resolveBundledBinary = (executable: string | undefined): string | undefined => {
		if (!artifact || !executable) return undefined;
		const candidate = mainSdk.resolvePluginAsset(
			`resources/nteract-mcp/${artifact.target}/${executable}`,
		);
		return existsSync(candidate) ? candidate : undefined;
	};
	const resolveNteractMcpBinary =
		options.resolveNteractMcpBinary ??
		(() => resolveBundledBinary(artifact?.nteractMcp.executable));
	const resolveRuntBinary =
		options.resolveRuntBinary ?? (() => resolveBundledBinary(artifact?.runt.executable));

	const entry = options.customSocketPath
		? (() => {
				const runtBinary = resolveRuntBinary();
				return runtBinary ? buildRuntMcpEntry(runtBinary, options.customSocketPath) : undefined;
			})()
		: (() => {
				const nteractMcpBinary = resolveNteractMcpBinary();
				if (!nteractMcpBinary) return undefined;
				const runtBinary = resolveRuntBinary();
				return runtBinary
					? buildNteractMcpEntry(nteractMcpBinary, options.runtimeChannel)
					: undefined;
			})();

	if (!entry) {
		await mcpConfig.remove("notebook", LEGACY_RUNT_MCP_ENTRY_NAME);
		await mcpConfig.remove("notebook", NTERACT_MCP_ENTRY_NAME);
		logger.info("Removed notebook MCP configuration because its bundled binary is not staged.");
		return;
	}

	await mcpConfig.remove("notebook", LEGACY_RUNT_MCP_ENTRY_NAME);
	await mcpConfig.set("notebook", NTERACT_MCP_ENTRY_NAME, entry);
}
