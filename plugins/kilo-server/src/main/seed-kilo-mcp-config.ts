import path from "node:path";

import type { KiloLogger } from "./KiloServerManager.js";
import {
	seedManagedMcpEntry,
	type SeededMcpEntry,
	type SeedOutcome,
} from "./seed-managed-mcp-entry.js";
import { resolveWebMcpRelayEntry } from "./webmcp-relay-entry.js";

/**
 * Interim WebMCP↔Kilo bridge — see anaconda/agentic-desktop#102.
 *
 * Seeds an `mcp["anaconda-desktop-relay"]` entry into the app-owned
 * `kilo.jsonc` so that `kilo serve` spawns the bundled WebMCP local-relay as
 * a stdio MCP subprocess and exposes every renderer-registered tool
 * (`sdk.tools` with `exposeToModelContext: true`) to Kilo's agents with zero
 * end-user configuration.
 */

export {
	KILO_CONFIG_FILENAME,
	MANAGED_SIDECAR_FILENAME,
	type SeededMcpEntry,
	type SeedOutcome,
} from "./seed-managed-mcp-entry.js";

export const MCP_ENTRY_NAME = "anaconda-desktop-relay";

/**
 * Identity-pinned rendezvous (see docs/webmcp.md §7 "Split-brain").
 *
 * The 9333–9348 loopback range is a shared, unauthenticated rendezvous used
 * by EVERY WebMCP relay on the machine (Claude Desktop configs, npx relays,
 * other apps). Without pinning, our widget pairs with the first relay that
 * answers (often a foreign/orphaned one on 9333) while kilo's own relay sits
 * elsewhere with zero producers — a split-brain where tools "disappear"
 * depending on which foreign process owns 9333 at scan time.
 *
 * - `--port 9345`: fixed-port mode. Far from the 9333 default foreign relays
 *   use, still inside the CSP-allowed 9333–9348 range. In fixed-port mode
 *   the relay refuses to silently chain to a non-relay owner.
 * - `--relay-id`: the widget (see `apps/web/src/platform/webmcp/installWebMcp.ts`,
 *   which must embed the SAME id) rejects any relay whose server-hello
 *   carries a different id, so foreign relays are invisible to our widget.
 *   The id is deliberately STABLE (not per-process): an orphaned relay from a
 *   previous run must still accept our widget's hello so that its dead stdio
 *   EPIPE-terminates it, letting the live relay take over the port.
 */
export const WEBMCP_RELAY_PORT = 9345;
export const WEBMCP_RELAY_ID = "anaconda-agentic-desktop";
export const WEBMCP_RELAY_LABEL = "Anaconda Agentic Desktop";

export interface SeedKiloMcpConfigOptions {
	/**
	 * Directory the seeded config file lives in — the same
	 * `XDG_CONFIG_HOME/kilo` that `KiloServerManager` passes to `kilo serve`.
	 */
	readonly configDirectory: string;
	/**
	 * Anaconda Desktop's own executable path (`app.getPath("exe")`). Kilo
	 * spawns this with `ELECTRON_RUN_AS_NODE=1`; requires the `RunAsNode`
	 * fuse to be `true` (see `forge.config.ts`).
	 */
	readonly appExecutablePath: string;
	/**
	 * When `false` we do not add the entry; if a previously-managed entry is
	 * present we remove it (self-heal on downgrade / rollback). Defaults to
	 * `true`; callers wire this to the `RunAsNode` fuse state at boot.
	 */
	readonly enabled?: boolean;
	/** Optional logger; defaults to a no-op. */
	readonly logger?: Pick<KiloLogger, "info" | "warn" | "error">;
	/** Test hook — production callers omit this. */
	readonly resolveRelay?: () => { entry: string; version: string };
}

function buildEntry(appExecutablePath: string, relayEntry: string): SeededMcpEntry {
	return {
		type: "local",
		command: [
			appExecutablePath,
			relayEntry,
			"--port",
			String(WEBMCP_RELAY_PORT),
			"--relay-id",
			WEBMCP_RELAY_ID,
			"--label",
			WEBMCP_RELAY_LABEL,
		],
		environment: { ELECTRON_RUN_AS_NODE: "1" },
		enabled: true,
	};
}

/**
 * Merge (or remove) the WebMCP relay managed entry into `kilo.jsonc`.
 *
 * Returns a structured `SeedOutcome`. Never throws for expected conditions
 * (missing file, empty file, unmanaged user entry, unparseable existing
 * file, unresolvable relay); surfaces unexpected I/O failures to the caller.
 */
export async function seedKiloMcpConfig(options: SeedKiloMcpConfigOptions): Promise<SeedOutcome> {
	const logger = options.logger ?? { info() {}, warn() {}, error() {} };
	const resolveRelay = options.resolveRelay ?? resolveWebMcpRelayEntry;
	const enabled = options.enabled ?? true;

	if (!enabled) {
		const outcome = await seedManagedMcpEntry({
			configDirectory: options.configDirectory,
			name: MCP_ENTRY_NAME,
			enabled: false,
			logger,
			label: "WebMCP relay",
		});
		if (outcome.kind === "removed") {
			return { kind: "removed", reason: "fuse-off" };
		}
		return outcome;
	}

	let relay: { entry: string; version: string };
	try {
		relay = resolveRelay();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.warn(`Skipping WebMCP seed: ${message}`);
		return { kind: "skipped-error", reason: message };
	}

	const outcome = await seedManagedMcpEntry({
		configDirectory: options.configDirectory,
		name: MCP_ENTRY_NAME,
		entry: buildEntry(options.appExecutablePath, relay.entry),
		enabled: true,
		logger,
		label: `WebMCP relay (@mcp-b/webmcp-local-relay@${relay.version})`,
	});
	return outcome;
}

/** Config directory under the kilo-server runtime root. */
export function kiloMcpConfigDirectory(runtimeDirectory: string): string {
	return path.join(runtimeDirectory, "config", "kilo");
}
