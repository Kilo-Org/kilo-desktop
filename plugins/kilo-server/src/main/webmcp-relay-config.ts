import path from "node:path";

import type { KiloLogger } from "./KiloServerManager.js";
import {
	KILO_CONFIG_FILENAME,
	OWNERSHIP_SIDECAR_FILENAME,
	KiloConfigManager,
	type KiloConfigMutationOutcome,
} from "./KiloConfigManager.js";
import { resolveWebMcpRelayEntry } from "./webmcp-relay-entry.js";

/**
 * Interim WebMCP↔Kilo bridge — see #102.
 *
 * Reconciles the bundled WebMCP relay in Desktop's Kilo config. Generic
 * JSONC mutation and ownership tracking live in `KiloConfigManager`; this
 * module only resolves and builds the relay-specific entry.
 */

export { KILO_CONFIG_FILENAME, OWNERSHIP_SIDECAR_FILENAME };
export const MCP_ENTRY_NAME = "desktop";
export const MCP_ENTRY_SOURCE_ID = "kilo-server";
const STALE_WEBMCP_RELAY_ENTRY_NAMES = ["anaconda-desktop-relay"] as const;

export const WEBMCP_RELAY_PORT = 9345;
export const WEBMCP_RELAY_ID = "kilo-desktop";
export const WEBMCP_RELAY_LABEL = "Kilo Desktop";

export type WebMcpChannel = "development" | "preview" | "stable";

export interface WebMcpRendezvous {
	readonly port: number;
	readonly relayId: string;
	readonly label: string;
}

const WEBMCP_RENDEZVOUS_BY_CHANNEL = {
	stable: { port: 9345, relayId: "kilo-desktop", label: "Kilo Desktop" },
	preview: { port: 9346, relayId: "kilo-desktop-preview", label: "Kilo Desktop Preview" },
	development: { port: 9347, relayId: "kilo-desktop-dev", label: "Kilo Desktop Dev" },
} as const satisfies Record<WebMcpChannel, WebMcpRendezvous>;

export function resolveWebMcpRendezvous(channel: WebMcpChannel = "stable"): WebMcpRendezvous {
	return WEBMCP_RENDEZVOUS_BY_CHANNEL[channel];
}

export function webMcpChannelFromStorageDir(storageDir: string): WebMcpChannel {
	const profile = path.basename(path.dirname(path.dirname(storageDir)));
	if (profile === "Kilo Desktop Dev") return "development";
	if (profile === "Kilo Desktop Preview") return "preview";
	return "stable";
}

export function isDesktopWebMcpRelayEntry(entry: unknown): boolean {
	if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
	const command = (entry as { command?: unknown }).command;
	if (!Array.isArray(command)) return false;
	const tokens = command.map(String);
	if (!tokens.some((token) => token.includes("webmcp-local-relay"))) return false;
	const relayId = tokens[tokens.indexOf("--relay-id") + 1];
	return (
		relayId === WEBMCP_RELAY_ID ||
		relayId === "kilo-desktop-preview" ||
		relayId === "kilo-desktop-dev" ||
		relayId === "anaconda-agentic-desktop"
	);
}

export type WebMcpRelayEntry = Readonly<Record<string, unknown>> & {
	readonly type: "local";
	readonly command: readonly [string, ...string[]];
	readonly environment: Readonly<Record<string, string>>;
	readonly enabled: true;
};

export interface ReconcileWebMcpRelayConfigOptions {
	readonly configDirectory: string;
	readonly appExecutablePath: string;
	readonly relayRuntimeRoot?: string;
	readonly enabled?: boolean;
	readonly logger?: Pick<KiloLogger, "info" | "warn" | "error">;
	readonly resolveRelay?: () => { entry: string; version: string };
	/** Shares the registration's serialized writer with runtime MCP updates. */
	readonly kiloConfig?: Pick<KiloConfigManager, "setMcpEntry" | "removeMcpEntry">;
	readonly port?: number;
	readonly relayId?: string;
	readonly label?: string;
}

/** Builds the CLI argv for Kilo's Desktop-provided stdio MCP relay child. */
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

export type WebMcpRelayConfigOutcome =
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
				| "entry-not-owned"
				| "owned-by-other-source"
				| "up-to-date"
				| "nothing-to-remove";
	  }
	| { readonly kind: "skipped-error"; readonly reason: string };

function buildEntry(
	appExecutablePath: string,
	relayEntry: string,
	rendezvous?: Pick<WebMcpRendezvous, "port" | "relayId" | "label">,
): WebMcpRelayEntry {
	return {
		type: "local",
		command: [
			appExecutablePath,
			...buildWebMcpRelayArgv(relayEntry, {
				...(rendezvous?.port !== undefined ? { port: rendezvous.port } : {}),
				...(rendezvous?.relayId ? { relayId: rendezvous.relayId } : {}),
				...(rendezvous?.label ? { label: rendezvous.label } : {}),
			}),
		],
		environment: { ELECTRON_RUN_AS_NODE: "1" },
		enabled: true,
	};
}

function mapRemovalOutcome(outcome: KiloConfigMutationOutcome): WebMcpRelayConfigOutcome {
	if (outcome.kind === "removed") return { kind: "removed", reason: "fuse-off" };
	if (outcome.kind === "written") {
		return { kind: "skipped-error", reason: "unexpected write while removing WebMCP relay" };
	}
	return outcome;
}

export async function reconcileWebMcpRelayConfig(
	options: ReconcileWebMcpRelayConfigOptions,
): Promise<WebMcpRelayConfigOutcome> {
	const logger = options.logger ?? { info() {}, warn() {}, error() {} };
	const kiloConfig = options.kiloConfig ?? new KiloConfigManager(options.configDirectory, logger);

	if (options.enabled === false) {
		for (const staleName of STALE_WEBMCP_RELAY_ENTRY_NAMES) {
			await kiloConfig.removeMcpEntry(MCP_ENTRY_SOURCE_ID, staleName, {
				adoptExisting: isDesktopWebMcpRelayEntry,
			});
		}
		return mapRemovalOutcome(
			await kiloConfig.removeMcpEntry(MCP_ENTRY_SOURCE_ID, MCP_ENTRY_NAME, {
				adoptExisting: isDesktopWebMcpRelayEntry,
			}),
		);
	}

	let relay: { entry: string; version: string };
	try {
		relay = options.resolveRelay
			? options.resolveRelay()
			: resolveWebMcpRelayEntry({
					...(options.relayRuntimeRoot ? { runtimeRoot: options.relayRuntimeRoot } : {}),
				});
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		logger.warn(`Skipping WebMCP configuration: ${reason}`);
		return { kind: "skipped-error", reason };
	}

	const entry = buildEntry(options.appExecutablePath, relay.entry, {
		port: options.port ?? WEBMCP_RELAY_PORT,
		relayId: options.relayId ?? WEBMCP_RELAY_ID,
		label: options.label ?? WEBMCP_RELAY_LABEL,
	});
	for (const staleName of STALE_WEBMCP_RELAY_ENTRY_NAMES) {
		await kiloConfig.removeMcpEntry(MCP_ENTRY_SOURCE_ID, staleName, {
			adoptExisting: isDesktopWebMcpRelayEntry,
		});
	}

	const outcome = await kiloConfig.setMcpEntry(MCP_ENTRY_SOURCE_ID, MCP_ENTRY_NAME, entry, {
		adoptExisting: isDesktopWebMcpRelayEntry,
	});
	if (outcome.kind !== "written") return outcome;
	logger.info(
		`Initialized WebMCP relay entry (${outcome.reason}) using @mcp-b/webmcp-local-relay@${relay.version}.`,
	);
	return { ...outcome, entry };
}
