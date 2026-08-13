import type { KiloLogger } from "./KiloServerManager.js";
import {
	KILO_CONFIG_FILENAME,
	MANAGED_SIDECAR_FILENAME,
	ManagedKiloConfig,
	type ManagedMcpOutcome,
} from "./ManagedKiloConfig.js";
import { resolveWebMcpRelayEntry } from "./webmcp-relay-entry.js";

/**
 * Interim WebMCP↔Kilo bridge — see anaconda/agentic-desktop#102.
 *
 * Initializes the bundled WebMCP relay into Desktop's owned Kilo config. Generic
 * JSONC mutation and ownership tracking live in `ManagedKiloConfig`; this
 * module only resolves and builds the relay-specific entry.
 */

export { KILO_CONFIG_FILENAME, MANAGED_SIDECAR_FILENAME };
export const MCP_ENTRY_NAME = "anaconda-desktop-relay";
export const MCP_ENTRY_SOURCE_ID = "kilo-server";

export const WEBMCP_RELAY_PORT = 9345;
export const WEBMCP_RELAY_ID = "anaconda-agentic-desktop";
export const WEBMCP_RELAY_LABEL = "Anaconda Agentic Desktop";

export type WebMcpRelayEntry = Readonly<Record<string, unknown>> & {
	readonly type: "local";
	readonly command: readonly [string, ...string[]];
	readonly environment: Readonly<Record<string, string>>;
	readonly enabled: true;
};

export interface InitializeManagedConfigOptions {
	readonly configDirectory: string;
	readonly appExecutablePath: string;
	readonly enabled?: boolean;
	readonly logger?: Pick<KiloLogger, "info" | "warn" | "error">;
	readonly resolveRelay?: () => { entry: string; version: string };
	/** Shares the registration's serialized writer with runtime MCP updates. */
	readonly managedConfig?: Pick<ManagedKiloConfig, "setMcpEntry" | "removeMcpEntry">;
}

/** Builds the CLI argv for Kilo's managed stdio MCP relay child. */
export function buildWebMcpRelayArgv(
	relayEntry: string,
	options?: {
		readonly port?: number;
		readonly relayId?: string;
		readonly label?: string;
	},
): string[] {
	return [
		relayEntry,
		"--port",
		String(options?.port ?? WEBMCP_RELAY_PORT),
		"--relay-id",
		options?.relayId ?? WEBMCP_RELAY_ID,
		"--label",
		options?.label ?? WEBMCP_RELAY_LABEL,
	];
}

export type ManagedConfigInitializationOutcome =
	| {
			readonly kind: "written";
			readonly reason: "created" | "updated";
			readonly entry: WebMcpRelayEntry;
	  }
	| {
			readonly kind: "removed";
			readonly reason: "fuse-off" | "explicit";
	  }
	| {
			readonly kind: "skipped";
			readonly reason:
				| "unmanaged-entry"
				| "owned-by-other-source"
				| "up-to-date"
				| "nothing-to-remove";
	  }
	| { readonly kind: "skipped-error"; readonly reason: string };

function buildEntry(appExecutablePath: string, relayEntry: string): WebMcpRelayEntry {
	return {
		type: "local",
		command: [appExecutablePath, ...buildWebMcpRelayArgv(relayEntry)],
		environment: { ELECTRON_RUN_AS_NODE: "1" },
		enabled: true,
	};
}

function mapRemovalOutcome(outcome: ManagedMcpOutcome): ManagedConfigInitializationOutcome {
	if (outcome.kind === "removed") return { kind: "removed", reason: "fuse-off" };
	if (outcome.kind === "written") {
		return { kind: "skipped-error", reason: "unexpected write while removing WebMCP relay" };
	}
	return outcome;
}

export async function initializeManagedConfig(
	options: InitializeManagedConfigOptions,
): Promise<ManagedConfigInitializationOutcome> {
	const logger = options.logger ?? { info() {}, warn() {}, error() {} };
	const managedConfig =
		options.managedConfig ?? new ManagedKiloConfig(options.configDirectory, logger);

	if (options.enabled === false) {
		return mapRemovalOutcome(
			await managedConfig.removeMcpEntry(MCP_ENTRY_SOURCE_ID, MCP_ENTRY_NAME),
		);
	}

	let relay: { entry: string; version: string };
	try {
		relay = (options.resolveRelay ?? resolveWebMcpRelayEntry)();
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		logger.warn(`Skipping WebMCP configuration: ${reason}`);
		return { kind: "skipped-error", reason };
	}

	const entry = buildEntry(options.appExecutablePath, relay.entry);
	const outcome = await managedConfig.setMcpEntry(MCP_ENTRY_SOURCE_ID, MCP_ENTRY_NAME, entry);
	if (outcome.kind !== "written") return outcome;
	logger.info(
		`Initialized WebMCP relay entry (${outcome.reason}) using @mcp-b/webmcp-local-relay@${relay.version}.`,
	);
	return { ...outcome, entry };
}
