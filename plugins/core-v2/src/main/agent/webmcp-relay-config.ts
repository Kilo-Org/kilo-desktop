import path from "node:path";

import type { KiloLogger } from "./KiloServerManager.js";
import type { KiloMcpServer } from "./kilo-config-types.js";
import { KiloConfigManager, type KiloConfigMutationOutcome } from "./KiloConfigManager.js";

/**
 * Reconciles the Desktop-owned `mcp.servers.desktop` entry in Desktop's Kilo config.
 * The entry points Kilo at the in-process Streamable HTTP endpoint
 * (`KiloToolEndpoint`). Generic JSONC mutation and ownership tracking live
 * in `KiloConfigManager`; this module only builds the entry.
 */

export const MCP_ENTRY_NAME = "desktop";
/** The source id of kilo.core's own entries in the app-owned Kilo config. */
export const MCP_ENTRY_SOURCE_ID = "kilo.core";

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

/** The `mcp.servers.desktop` entry. */
export type WebMcpRelayEntry = Extract<KiloMcpServer, { type: "remote" }>;

const DESKTOP_WEBMCP_ENTRY: WebMcpRelayEntry = {
	type: "remote",
	url: `{env:${WEBMCP_ENDPOINT_URL_ENV}}`,
	// A loopback endpoint with a bearer token; skip Kilo's OAuth discovery.
	oauth: false,
	headers: { Authorization: `Bearer {env:${WEBMCP_ENDPOINT_TOKEN_ENV}}` },
	// v2 wraps MCP tools in Code Mode by default; Desktop's tool renderers and
	// approvals need each tool called by its own name.
	codemode: false,
};

/** Desktop's entry, recognised by its endpoint URL so an unowned copy (its sidecar lost) is adopted. */
export function isDesktopWebMcpRelayEntry(entry: unknown): boolean {
	return (
		typeof entry === "object" &&
		entry !== null &&
		(entry as { url?: unknown }).url === DESKTOP_WEBMCP_ENTRY.url
	);
}

export interface ReconcileWebMcpRelayConfigOptions {
	readonly configDirectory: string;
	/** False when the in-process MCP endpoint is not running; the entry is then removed. */
	readonly enabled?: boolean;
	readonly logger?: Pick<KiloLogger, "info" | "warn" | "error">;
	/** Shares the registration's serialized writer with runtime MCP updates. */
	readonly kiloConfig?: Pick<KiloConfigManager, "setEntry" | "removeEntry">;
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

	const adopt = { adoptExisting: isDesktopWebMcpRelayEntry };
	if (options.enabled === false) {
		return mapRemovalOutcome(
			await kiloConfig.removeEntry("mcp.servers", MCP_ENTRY_SOURCE_ID, MCP_ENTRY_NAME, adopt),
		);
	}

	const entry = DESKTOP_WEBMCP_ENTRY;
	const outcome = await kiloConfig.setEntry(
		"mcp.servers",
		MCP_ENTRY_SOURCE_ID,
		MCP_ENTRY_NAME,
		entry,
		adopt,
	);
	if (outcome.kind !== "written") return outcome;
	logger.info(`Initialized the Desktop WebMCP entry (${outcome.reason}).`);
	return { ...outcome, entry };
}
