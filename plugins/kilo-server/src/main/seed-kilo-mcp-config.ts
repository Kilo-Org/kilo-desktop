import path from "node:path";

import type { KiloConfigOverlay } from "../contracts/schemas.js";
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
 * Builds the `mcp["anaconda-desktop-relay"]` overlay injected via
 * `KILO_CONFIG_CONTENT` at `kilo serve` spawn. Kilo shares host XDG
 * (`~/.config/kilo`); writing into the app-owned runtime `kilo.jsonc` is no
 * longer read by the child — the overlay keeps the relay scoped to the
 * Desktop-spawned server without touching the user's shared config.
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

export interface BuildWebMcpRelayOverlayOptions {
	/**
	 * Anaconda Desktop's own executable path (`app.getPath("exe")`). Kilo
	 * spawns this with `ELECTRON_RUN_AS_NODE=1`; requires the `RunAsNode`
	 * fuse to be `true` (see `forge.config.ts`).
	 */
	readonly appExecutablePath: string;
	/** Optional logger; defaults to a no-op. */
	readonly logger?: Pick<KiloLogger, "info" | "warn" | "error">;
	/** Test hook — production callers omit this. */
	readonly resolveRelay?: () => { entry: string; version: string };
}

export type WebMcpRelayOverlayResult =
	| {
			readonly kind: "ok";
			readonly overlay: KiloConfigOverlay;
			readonly entry: SeededMcpEntry;
			readonly version: string;
	  }
	| { readonly kind: "skipped-error"; readonly reason: string };

export interface SeedKiloMcpConfigOptions {
	/**
	 * Directory used only to clean leftover pre-shared-XDG file seeds under
	 * the app-owned runtime path. Live injection uses {@link buildWebMcpRelayOverlay}.
	 */
	readonly configDirectory: string;
	readonly appExecutablePath: string;
	/**
	 * When `false` we do not add the entry; if a previously-managed entry is
	 * present we remove it (self-heal on downgrade / rollback). Defaults to
	 * `true`; callers wire this to the `RunAsNode` fuse state at boot.
	 */
	readonly enabled?: boolean;
	readonly logger?: Pick<KiloLogger, "info" | "warn" | "error">;
	readonly resolveRelay?: () => { entry: string; version: string };
}

/**
 * Argv shared by the main-owned rendezvous supervisor and kilo's MCP overlay
 * child. When kilo connects the overlay entry it spawns a second process that
 * joins the live `:9345` server in client mode and proxies tools over stdio.
 */
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

function buildEntry(appExecutablePath: string, relayEntry: string): SeededMcpEntry {
	return {
		type: "local",
		command: [appExecutablePath, ...buildWebMcpRelayArgv(relayEntry)],
		environment: { ELECTRON_RUN_AS_NODE: "1" },
		enabled: true,
	};
}

/**
 * Resolve the bundled relay CLI and build the MCP overlay payload injected
 * via `KILO_CONFIG_CONTENT`. Never throws for expected conditions (missing
 * relay package); returns `skipped-error` so the bridge stays optional.
 */
export function buildWebMcpRelayOverlay(
	options: BuildWebMcpRelayOverlayOptions,
): WebMcpRelayOverlayResult {
	const logger = options.logger ?? { info() {}, warn() {}, error() {} };
	const resolveRelay = options.resolveRelay ?? resolveWebMcpRelayEntry;

	let relay: { entry: string; version: string };
	try {
		relay = resolveRelay();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		logger.warn(`Skipping WebMCP relay overlay: ${message}`);
		return { kind: "skipped-error", reason: message };
	}

	const entry = buildEntry(options.appExecutablePath, relay.entry);
	return {
		kind: "ok",
		entry,
		version: relay.version,
		overlay: { mcp: { [MCP_ENTRY_NAME]: entry } },
	};
}

/**
 * Removes a leftover file-based managed entry from the pre-shared-XDG
 * app-owned `kilo.jsonc`. Live injection uses {@link buildWebMcpRelayOverlay}.
 */
export async function seedKiloMcpConfig(options: SeedKiloMcpConfigOptions): Promise<SeedOutcome> {
	const logger = options.logger ?? { info() {}, warn() {}, error() {} };
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

	// Prefer overlay injection; still prune any stale file entry so the
	// orphaned runtime/config/kilo copy does not confuse debugging.
	const overlay = buildWebMcpRelayOverlay({
		appExecutablePath: options.appExecutablePath,
		logger,
		...(options.resolveRelay !== undefined ? { resolveRelay: options.resolveRelay } : {}),
	});
	if (overlay.kind !== "ok") {
		return { kind: "skipped-error", reason: overlay.reason };
	}

	await seedManagedMcpEntry({
		configDirectory: options.configDirectory,
		name: MCP_ENTRY_NAME,
		enabled: false,
		logger,
		label: "WebMCP relay (stale file seed)",
	});

	return {
		kind: "written",
		reason: "created",
		entry: overlay.entry,
	};
}

/** Config directory under the kilo-server runtime root (stale-file cleanup only). */
export function kiloMcpConfigDirectory(runtimeDirectory: string): string {
	return path.join(runtimeDirectory, "config", "kilo");
}
