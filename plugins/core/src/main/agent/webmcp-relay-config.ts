import path from "node:path";

import type { KiloLogger } from "./KiloServerManager.js";
import { KiloConfigManager, type KiloConfigMutationOutcome } from "./KiloConfigManager.js";

/**
 * Reconciles the Desktop-owned `mcp.desktop` entry in Desktop's Kilo config.
 * The entry points Kilo at the in-process Streamable HTTP endpoint
 * (`KiloToolEndpoint`), as a Kilo v2 remote MCP server (`Mcp.RemoteConfig`).
 * Generic JSONC mutation and ownership tracking live in `KiloConfigManager`;
 * this module only builds and recognizes the entry. Desktop's v2 config file
 * starts fresh, so the stdio relay entries earlier builds wrote into v1's
 * `kilo.jsonc` never appear here.
 */

export const MCP_ENTRY_NAME = "desktop";
/** kilo.agent wrote the entry first; config ownership is persisted, so the id stays. */
export const MCP_ENTRY_SOURCE_ID = "kilo.agent";

export type WebMcpChannel = "development" | "preview" | "stable";

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
	codemode: false;
}>;

const DESKTOP_WEBMCP_ENTRY: WebMcpRelayEntry = {
	type: "remote",
	url: `{env:${WEBMCP_ENDPOINT_URL_ENV}}`,
	// A loopback endpoint with a bearer token; skip Kilo's OAuth discovery.
	oauth: false,
	headers: { Authorization: `Bearer {env:${WEBMCP_ENDPOINT_TOKEN_ENV}}` },
	// Kilo v2 offers MCP tools through its Code Mode `execute` tool unless told
	// otherwise. Desktop's tools stay direct calls named `desktop_<tool>`: chat
	// renderers, permission rules and the caller-context plugin key on them.
	codemode: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isDesktopWebMcpRelayEntry(entry: unknown): boolean {
	return isRecord(entry) && entry.url === DESKTOP_WEBMCP_ENTRY.url;
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
		return mapRemovalOutcome(
			await kiloConfig.removeMcpEntry(MCP_ENTRY_SOURCE_ID, MCP_ENTRY_NAME, {
				adoptExisting: isDesktopWebMcpRelayEntry,
			}),
		);
	}

	const entry = DESKTOP_WEBMCP_ENTRY;

	const outcome = await kiloConfig.setMcpEntry(MCP_ENTRY_SOURCE_ID, MCP_ENTRY_NAME, entry, {
		adoptExisting: isDesktopWebMcpRelayEntry,
	});
	if (outcome.kind !== "written") return outcome;
	logger.info(`Initialized the Desktop WebMCP entry (${outcome.reason}).`);
	return { ...outcome, entry };
}
