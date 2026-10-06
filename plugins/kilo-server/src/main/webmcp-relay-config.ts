import path from "node:path";

import { APP_RENDERER_ORIGINS } from "./app-renderer-origins.js";
import type { KiloLogger } from "./KiloServerManager.js";
import {
	KILO_CONFIG_FILENAME,
	OWNERSHIP_SIDECAR_FILENAME,
	KiloConfigManager,
	type KiloConfigMutationOutcome,
} from "./KiloConfigManager.js";

/**
 * Reconciles the Desktop-owned `mcp.desktop` entry in Desktop's Kilo config.
 * The entry points Kilo at the in-process Streamable HTTP endpoint
 * (`WebMcpHttpEndpoint`). Generic JSONC mutation and ownership tracking live
 * in `KiloConfigManager`; this module only builds the entry and recognizes the
 * stdio relay entries that earlier builds wrote, so they are migrated.
 */

export { KILO_CONFIG_FILENAME, OWNERSHIP_SIDECAR_FILENAME };
export const MCP_ENTRY_NAME = "desktop";
export const MCP_ENTRY_SOURCE_ID = "kilo-server";
const STALE_WEBMCP_RELAY_ENTRY_NAMES = ["anaconda-desktop-relay"] as const;

export const WEBMCP_RELAY_PORT = 9345;
export const WEBMCP_RELAY_ID = "kilo-desktop";
export const WEBMCP_RELAY_LABEL = "Kilo Desktop";

/**
 * Page origins allowed to register tool sources on the relay. Restricts tool
 * sources to the app renderer; the relay library's default admits any origin.
 * External MCP clients connect without an Origin header and are unaffected.
 */
export const WEBMCP_TOOL_SOURCE_ORIGINS = APP_RENDERER_ORIGINS;

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

/** Kilo reads the per-launch endpoint URL and token from these `kilo serve` env vars. */
export const WEBMCP_ENDPOINT_URL_ENV = "KILO_DESKTOP_WEBMCP_URL";
export const WEBMCP_ENDPOINT_TOKEN_ENV = "KILO_DESKTOP_WEBMCP_TOKEN";

export type WebMcpRelayEntry = Readonly<{
	type: "remote";
	url: string;
	oauth: false;
	headers: Readonly<Record<string, string>>;
	enabled: true;
}>;

const DESKTOP_WEBMCP_ENTRY: WebMcpRelayEntry = {
	type: "remote",
	url: `{env:${WEBMCP_ENDPOINT_URL_ENV}}`,
	// A loopback endpoint with a bearer token; skip Kilo's OAuth discovery.
	oauth: false,
	headers: { Authorization: `Bearer {env:${WEBMCP_ENDPOINT_TOKEN_ENV}}` },
	enabled: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The stdio relay child (`webmcp-local-relay` run as Node) written by earlier builds. */
function isLegacyStdioRelayEntry(entry: Record<string, unknown>): boolean {
	const command = entry.command;
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

export function isDesktopWebMcpRelayEntry(entry: unknown): boolean {
	if (!isRecord(entry)) return false;
	return entry.url === DESKTOP_WEBMCP_ENTRY.url || isLegacyStdioRelayEntry(entry);
}

export interface ReconcileWebMcpRelayConfigOptions {
	readonly configDirectory: string;
	/** False when the in-process MCP endpoint is not running; the entry is then removed. */
	readonly enabled?: boolean;
	readonly logger?: Pick<KiloLogger, "info" | "warn" | "error">;
	/** Shares the registration's serialized writer with runtime MCP updates. */
	readonly kiloConfig?: Pick<KiloConfigManager, "setMcpEntry" | "removeMcpEntry">;
}

export type WebMcpRelayConfigOutcome =
	| {
			readonly kind: "written";
			readonly reason: "created" | "updated";
			readonly entry: WebMcpRelayEntry;
	  }
	| {
			readonly kind: "removed";
			readonly reason: "endpoint-unavailable" | "explicit";
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

function mapRemovalOutcome(outcome: KiloConfigMutationOutcome): WebMcpRelayConfigOutcome {
	if (outcome.kind === "removed") return { kind: "removed", reason: "endpoint-unavailable" };
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

	const entry = DESKTOP_WEBMCP_ENTRY;
	for (const staleName of STALE_WEBMCP_RELAY_ENTRY_NAMES) {
		await kiloConfig.removeMcpEntry(MCP_ENTRY_SOURCE_ID, staleName, {
			adoptExisting: isDesktopWebMcpRelayEntry,
		});
	}

	const outcome = await kiloConfig.setMcpEntry(MCP_ENTRY_SOURCE_ID, MCP_ENTRY_NAME, entry, {
		adoptExisting: isDesktopWebMcpRelayEntry,
	});
	if (outcome.kind !== "written") return outcome;
	logger.info(`Initialized the Desktop WebMCP entry (${outcome.reason}).`);
	return { ...outcome, entry };
}
