import type { AnacondaMcpStatus } from "@anaconda-agentic-desktop/contracts";
import type { AuthMainCapability } from "@anaconda-agentic-desktop/contracts";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";
import type { KiloServerCapabilities } from "@anaconda-agentic-desktop/plugin-kilo-server/contracts";
import isEqual from "lodash/isEqual.js";

/** Default Anaconda Remote MCP URL. Override via settings. */
export const DEFAULT_MCP_URL = "https://anaconda.cloud/api/mcp";

/** Stable MCP server ID written to kilo.json. */
export const MCP_ID = "anaconda-remote";

/** Env var name that Kilo expands in the `{env:VAR}` header template. */
export const MCP_ENV_VAR = "ANACONDA_API_KEY";

export interface AnacondaMcpServiceOptions {
	/** Whether the feature is enabled by the user. Default true. */
	enabled: boolean;
	/** User-provided URL override, or null for the default. */
	urlOverride: string | null;
}

export interface AnacondaMcpServiceDeps {
	sdk: MainSdk;
	getSettings: () => AnacondaMcpServiceOptions;
	setSettings: (patch: Partial<AnacondaMcpServiceOptions>) => void;
}

/**
 * Reconciliation-driven state machine that wires the Anaconda Remote MCP
 * into the running Kilo server. On each trigger (boot, auth change, settings
 * change) it computes the desired state, diffs against the current effective
 * state, and applies the minimum set of mutations.
 *
 * Two independent side effects per successful reconcile:
 *
 * 1. Write the MCP entry to `~/.config/kilo/kilo.jsonc` (shared with Kilo CLI
 *    and VS Code extension per PR #107), tagged with `_managedBy` so future
 *    versions can identify and clean up managed entries. The `Authorization`
 *    header is stored as a `{env:ANACONDA_API_KEY}` template — the raw key
 *    never lands on disk.
 *
 * 2. Contribute `ANACONDA_API_KEY` to the kilo-server spawn environment via
 *    `serverEnv.contribute`. Kilo resolves the header template against this
 *    env at request time.
 *
 * On disable / logout: config entry removed and env contribution disposed.
 *
 * ## Ownership: Desktop-managed, not user-edited
 *
 * The `anaconda-remote` entry is a *managed projection* — the Desktop app
 * is the source of truth for its shape. On every reconcile after boot,
 * `#ensureMcpConfig` checks in-memory state (`#mcpConfigured`), which
 * resets to `false` when the process starts, so the entry is unconditionally
 * re-written on first reconcile of each session. This means:
 *
 *   - Hand-deleting the entry from `kilo.jsonc` → **re-added on next launch**
 *   - Hand-editing the URL or headers → **overwritten on next launch**
 *   - Setting `"enabled": false` in the file → **flipped back to `true`**
 *
 * The `_managedBy: "anaconda-desktop"` marker on the entry signals this to
 * anyone reading the file. The intended user-facing opt-out is the
 * "Enable Anaconda MCP" toggle in the settings panel, which persists to
 * `${storageDir}/settings.json` and gates the entire reconcile. To use a
 * different URL, use the URL override in the settings panel — it flows
 * through `getSettings()` and drives the `saveMcp` call.
 */
export class AnacondaMcpService {
	#status: AnacondaMcpStatus = { state: "waiting-for-auth" };
	#envDisposer: (() => void) | null = null;
	#mcpConfigured = false;
	#lastConfiguredUrl: string | null = null;
	#lastApiKey: string | null = null;
	#reconciling = false;
	#reconcilePending = false;
	#disposed = false;
	readonly #deps: AnacondaMcpServiceDeps;

	constructor(deps: AnacondaMcpServiceDeps) {
		this.#deps = deps;
	}

	get status(): AnacondaMcpStatus {
		return this.#status;
	}

	/**
	 * Reconcile the desired state against the current state.
	 * Called on boot, auth.changed, kilo-server ready, and settings changes.
	 *
	 * Serialized: concurrent callers see the running reconcile complete, then
	 * exactly one additional reconcile runs to pick up the latest state.
<<<<<<< HEAD
	 * Prevents interleaved awaits from producing a state that disagrees with
	 * the latest desired settings.
=======
	 *
	 * When `dispose()` is called mid-reconcile, the outer loop notices the
	 * `#disposed` flag on the next iteration and performs teardown instead of
	 * a normal reconcile — so dispose never races the state machine that owns
	 * `#envDisposer`, `#mcpConfigured`, and status transitions.
>>>>>>> bb3443b (fix(anaconda-mcp,kilo-server): address kilo-code-bot CRITICAL + all 8 WARNINGs)
	 */
	async reconcile(): Promise<void> {
		if (this.#reconciling) {
			// A reconcile is already running — mark that a subsequent one is needed
			// so we don't lose the trigger, then let the in-flight run handle it.
			this.#reconcilePending = true;
			return;
		}
		this.#reconciling = true;
		try {
			do {
				this.#reconcilePending = false;
				if (this.#disposed) {
					await this.#teardown(this.#deps.sdk.plugins.get<KiloServerCapabilities>("kilo-server"));
					this.#setStatus({ state: "disabled" });
					return;
				}
				await this.#doReconcile();
			} while (this.#reconcilePending);
		} finally {
			this.#reconciling = false;
		}
	}

	async #doReconcile(): Promise<void> {
		const { sdk, getSettings } = this.#deps;
		const settings = getSettings();

		// 1. If disabled, tear down everything.
		if (!settings.enabled) {
			const kilo = sdk.plugins.get<KiloServerCapabilities>("kilo-server");
			await this.#teardown(kilo);
			this.#setStatus({ state: "disabled" });
			return;
		}

		// 2. Resolve kilo-server capability.
		const kilo = sdk.plugins.get<KiloServerCapabilities>("kilo-server");
		if (!kilo) {
			await this.#teardown(null);
			this.#setStatus({ state: "waiting-for-kilo" });
			return;
		}

		// 3. Resolve auth capability and get the API key.
		const auth = sdk.plugins.get<AuthMainCapability>("auth");
		const apiKey = await auth?.auth.getApiKey();
		if (!apiKey) {
			await this.#teardown(kilo);
			this.#setStatus({ state: "waiting-for-auth" });
			return;
		}

		// 4. Compute desired URL.
		const url = settings.urlOverride ?? DEFAULT_MCP_URL;

		// 5. Apply MCP config (idempotent — uses a stable ID).
		try {
			await this.#ensureMcpConfig(kilo, url);
		} catch (cause) {
			this.#setStatus({
				state: "error",
				reason: cause instanceof Error ? cause.message : String(cause),
			});
			return;
		}

		// 6. Apply env contribution (idempotent — same sourceId overwrites).
		this.#ensureEnvContribution(kilo, apiKey);

		// 7. Success.
		this.#setStatus({ state: "connected", url });
	}

	/**
<<<<<<< HEAD
	 * Clean up all external state (env contribution + MCP config).
	 * Called on disable, logout, or feature teardown.
=======
	 * Clean up on plugin dispose. Serializes through the reconcile loop so a
	 * concurrent reconcile can't re-populate `#envDisposer` or `#mcpConfigured`
	 * after teardown has cleared them.
>>>>>>> bb3443b (fix(anaconda-mcp,kilo-server): address kilo-code-bot CRITICAL + all 8 WARNINGs)
	 */
	async dispose(): Promise<void> {
		this.#disposed = true;
		// Route through reconcile() so the disposed branch runs under the
		// same lock that guards #doReconcile(). If a reconcile is already
		// in flight, we queue as the pending run and it picks up the flag.
		await this.reconcile();
	}

	// ─── Private ────────────────────────────────────────────────────────────────

	async #ensureMcpConfig(kilo: KiloServerCapabilities, url: string): Promise<void> {
		// Skip if already configured with the same URL.
		if (this.#mcpConfigured && this.#lastConfiguredUrl === url) return;

		const headerValue = `Bearer {env:${MCP_ENV_VAR}}`;

		// Security assertion: never write a raw key into the config.
		if (!headerValue.includes("{env:")) {
			throw new Error("SECURITY: MCP header must use env-var template, not a raw key.");
		}

		await kilo.kiloService.saveMcp({
			id: MCP_ID,
			transport: {
				type: "remote" as const,
				url,
				headers: { Authorization: headerValue },
			},
			enabled: true,
			managedBy: "anaconda-desktop",
		});
		this.#mcpConfigured = true;
		this.#lastConfiguredUrl = url;
	}

	#ensureEnvContribution(kilo: KiloServerCapabilities, apiKey: string): void {
		// Skip if the key hasn't changed.
		if (this.#lastApiKey === apiKey) return;

		// Dispose previous contribution before setting a new one (handles key rotation).
		this.#envDisposer?.();
		this.#envDisposer = kilo.kiloService.serverEnv.contribute("anaconda-mcp", {
			[MCP_ENV_VAR]: apiKey,
		});
		this.#lastApiKey = apiKey;
	}

	async #teardown(kilo?: KiloServerCapabilities | null): Promise<void> {
		// Remove env contribution.
		if (this.#envDisposer) {
			this.#envDisposer();
			this.#envDisposer = null;
		}
		this.#lastApiKey = null;

		// Remove MCP config entry (if we wrote it).
		if (this.#mcpConfigured && kilo) {
			try {
				await kilo.kiloService.removeMcp({ id: MCP_ID });
			} catch {
				// Best effort — server may be down.
			}
			this.#mcpConfigured = false;
			this.#lastConfiguredUrl = null;
		}
	}

	#setStatus(next: AnacondaMcpStatus): void {
		const prev = this.#status;
		// Full structural equality: catches state changes, url changes on
		// `connected`, reason changes on `error`, and any future variant
		// field. The prior hand-rolled state+url comparison missed
		// `error` → `error` transitions with a different `reason`, so a
		// UI subscribed to status events never learned the failure mode
		// changed. `isEqual` handles nested payloads uniformly.
		if (isEqual(prev, next)) return;
		this.#status = next;
		this.#deps.sdk.events.emit("status-changed", next);
	}
}
