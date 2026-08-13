import type { AnacondaMcpStatus } from "@anaconda-agentic-desktop/contracts";
import {
	ANACONDA_MCP_STATUS_CHANGED,
	type AuthMainCapability,
	type FeatureFlagMainCapability,
} from "@anaconda-agentic-desktop/contracts";
import type { MainSdk, ObservableValue } from "@anaconda-agentic-desktop/feature-sdk";
import { createObservableValue } from "@anaconda-agentic-desktop/feature-sdk";
import type { KiloServerCapabilities } from "@anaconda-agentic-desktop/plugin-kilo-server/contracts";
import isEqual from "lodash/isEqual.js";

/**
 * Default Anaconda Remote MCP URL (production). Other environments (e.g.
 * `https://stage.anaconda.com/api/mcp`) go through the URL override in the
 * settings panel.
 */
export const DEFAULT_MCP_URL = "https://anaconda.com/api/mcp";

/** Stable MCP server ID contributed to the Kilo config overlay. */
export const MCP_ID = "anaconda-remote";

/** Env var name that Kilo expands in the `{env:VAR}` header template. */
export const MCP_ENV_VAR = "ANACONDA_API_KEY";

/** Source id for both contributions to the kilo-server plugin. */
export const CONTRIBUTION_SOURCE_ID = "anaconda-mcp";

/**
 * LaunchDarkly feature-flag key. When this evaluates to `false` (the default,
 * used when the flag is missing, the provider errors, or the user is not in
 * an enabled cohort) the feature is fully off: no MCP entry is contributed
 * and no env is contributed. Toggling the flag on at runtime triggers a
 * reconcile via the `feature-flag.changed` event.
 */
export const FEATURE_FLAG_KEY = "remote-anaconda-mcp";

export interface AnacondaMcpServiceOptions {
	/** Whether the feature is enabled by the user. Default true. */
	enabled: boolean;
	/** User-provided URL override, or null for the default. */
	urlOverride: string | null;
}

export interface AnacondaMcpServiceDeps {
	sdk: MainSdk;
	getSettings: () => AnacondaMcpServiceOptions;
}

/**
 * Reconciliation-driven state machine that wires the Anaconda Remote MCP
 * into the running Kilo server. On each trigger (boot, auth change, settings
 * change) it computes the desired state, diffs against the current effective
 * state, and applies the minimum set of mutations.
 *
 * Two contributions per successful reconcile, both scoped to the Kilo server
 * process that Desktop spawns:
 *
 * 1. Contribute the MCP entry as a config overlay
 *    (`kiloService.configOverlay.contribute`). The kilo-server plugin injects
 *    it via the `KILO_CONFIG_CONTENT` env var, which Kilo merges over the
 *    on-disk config at load time. Nothing is ever written to the user's
 *    shared `~/.config/kilo/kilo.jsonc` — no lost-update races with Kilo CLI
 *    / VS Code, no residue after uninstall, and other Kilo clients (which
 *    don't have `ANACONDA_API_KEY` in their environment) never see a broken
 *    entry. The `Authorization` header is the `{env:ANACONDA_API_KEY}`
 *    template — the raw key never appears in the overlay JSON.
 *
 * 2. Contribute `ANACONDA_API_KEY` to the kilo-server spawn environment via
 *    `serverEnv.contribute`. Kilo resolves the header template against this
 *    env at request time.
 *
 * Contribution changes trigger the kilo-server plugin's debounced restart, so
 * key rotation and URL changes converge without extra plumbing here.
 *
 * On disable / logout both contributions are disposed; the entry vanishes
 * from the server on its next restart.
 */
export class AnacondaMcpService {
	readonly #status: ObservableValue<AnacondaMcpStatus>;
	#envDisposer: (() => void) | null = null;
	#overlayDisposer: (() => void) | null = null;
	#reconciling = false;
	#reconcilePending = false;
	#disposed = false;
	/**
	 * Completion promise of the currently-running reconcile loop. Lets a
	 * caller that arrives while a loop is in flight (including `dispose()`)
	 * await the loop's full drain instead of resolving early.
	 */
	#loopDone: Promise<void> | null = null;
	readonly #deps: AnacondaMcpServiceDeps;

	constructor(deps: AnacondaMcpServiceDeps) {
		this.#deps = deps;
		// Structural equality is required: the prior hand-rolled `state/url`
		// comparison missed `error` → `error` transitions with a different
		// `reason`, so a UI subscribed to status events never learned the
		// failure mode changed. `isEqual` handles nested payloads uniformly
		// and any future variant fields.
		this.#status = createObservableValue<AnacondaMcpStatus>(
			{ state: "waiting-for-auth" },
			{ equals: isEqual },
		);
		this.#status.subscribe((next) => {
			this.#deps.sdk.events.emit(ANACONDA_MCP_STATUS_CHANGED, next);
		});
	}

	get status(): AnacondaMcpStatus {
		return this.#status.peek();
	}

	/**
	 * Reconcile the desired state against the current state.
	 * Called on boot, auth.changed, kilo-server ready, and settings changes.
	 *
	 * Serialized: concurrent callers await the running loop, which performs
	 * exactly one additional reconcile to pick up the latest state. The
	 * returned promise resolves only when the loop has fully drained — so a
	 * caller that queued a pending run (or set `#disposed`) observes its
	 * effect before the promise settles.
	 *
	 * When `dispose()` is called mid-reconcile, the loop notices the
	 * `#disposed` flag on the next iteration and performs teardown instead of
	 * a normal reconcile — so dispose never races the state machine that owns
	 * `#envDisposer`, `#overlayDisposer`, and status transitions.
	 */
	async reconcile(): Promise<void> {
		if (this.#reconciling) {
			// A reconcile loop is already running — mark that a subsequent run
			// is needed so we don't lose the trigger, then await the loop's
			// completion (it drains the pending flag before settling).
			this.#reconcilePending = true;
			return this.#loopDone ?? undefined;
		}
		this.#reconciling = true;
		this.#loopDone = (async () => {
			try {
				do {
					this.#reconcilePending = false;
					if (this.#disposed) {
						this.#teardown();
						this.#setStatus({ state: "disabled" });
						return;
					}
					// Per-iteration catch: a rejection (e.g. a keychain failure
					// in getApiKey) must not abort the loop, or a trigger that
					// queued during this iteration would be silently dropped
					// and the state machine left stale until an unrelated
					// event fires. Surface the failure as an error status —
					// the next trigger retries.
					try {
						await this.#doReconcile();
					} catch (cause) {
						this.#setStatus({
							state: "error",
							reason: cause instanceof Error ? cause.message : String(cause),
						});
					}
				} while (this.#reconcilePending);
			} finally {
				this.#reconciling = false;
				this.#loopDone = null;
			}
		})();
		return this.#loopDone;
	}

	async #doReconcile(): Promise<void> {
		const { sdk, getSettings } = this.#deps;
		const settings = getSettings();

		// 0. Feature flag gate. When the flag is off (the default) we behave
		//    exactly like a user-disabled feature: tear down any prior state
		//    and stay in `disabled`. The flag re-check happens on every
		//    reconcile, and mainRegister subscribes to `feature-flag.changed`
		//    so a live toggle flips the feature on/off without a restart.
		const featureFlag = sdk.plugins.get<FeatureFlagMainCapability>("feature-flag");
		const flagEnabled = featureFlag?.featureFlag.getFlag<boolean>(FEATURE_FLAG_KEY, false) ?? false;
		if (!flagEnabled) {
			this.#teardown();
			this.#setStatus({ state: "disabled" });
			return;
		}

		// 1. If the user turned it off in the settings panel, tear down.
		if (!settings.enabled) {
			this.#teardown();
			this.#setStatus({ state: "disabled" });
			return;
		}

		// 2. Resolve kilo-server capability.
		const kilo = sdk.plugins.get<KiloServerCapabilities>("kilo-server");
		if (!kilo) {
			this.#teardown();
			this.#setStatus({ state: "waiting-for-kilo" });
			return;
		}

		// 3. Resolve auth capability and get the API key.
		const auth = sdk.plugins.get<AuthMainCapability>("auth");
		const apiKey = await auth?.session.getApiKey();
		if (!apiKey) {
			this.#teardown();
			this.#setStatus({ state: "waiting-for-auth" });
			return;
		}

		// 4. Compute desired URL.
		const url = settings.urlOverride ?? DEFAULT_MCP_URL;

		// 5. Contribute the MCP overlay and the API key env. Contributions
		//    are idempotent per sourceId: re-contributing the same payload is
		//    a no-op inside the kilo-server plugin (deep-equality check), and
		//    a changed payload triggers its debounced server restart.
		this.#ensureContributions(kilo, url, apiKey);

		// 6. Success.
		this.#setStatus({ state: "connected", url });
	}

	/**
	 * Clean up on plugin dispose. Serializes through the reconcile loop so a
	 * concurrent reconcile can't re-populate the contributions after teardown
	 * has cleared them. The returned promise resolves only after teardown has
	 * actually run — `reconcile()` awaits the in-flight loop when one exists.
	 */
	async dispose(): Promise<void> {
		this.#disposed = true;
		await this.reconcile();
	}

	// ─── Private ────────────────────────────────────────────────────────────────

	#ensureContributions(kilo: KiloServerCapabilities, url: string, apiKey: string): void {
		// Contribute unconditionally: re-contributing under the same sourceId
		// REPLACES the previous contribution inside the kilo-server plugin,
		// and unchanged payloads are deduplicated there (deep-equality), so
		// this never causes a restart unless the URL or key actually changed.
		// Only the latest disposers are kept; superseded ones are inert.
		this.#overlayDisposer = kilo.kiloService.configOverlay.contribute(CONTRIBUTION_SOURCE_ID, {
			mcp: {
				[MCP_ID]: {
					type: "remote",
					url,
					enabled: true,
					headers: { Authorization: `Bearer {env:${MCP_ENV_VAR}}` },
				},
			},
		});
		this.#envDisposer = kilo.kiloService.serverEnv.contribute(CONTRIBUTION_SOURCE_ID, {
			[MCP_ENV_VAR]: apiKey,
		});
	}

	#teardown(): void {
		this.#overlayDisposer?.();
		this.#overlayDisposer = null;
		this.#envDisposer?.();
		this.#envDisposer = null;
	}

	#setStatus(next: AnacondaMcpStatus): void {
		// Change-gated by the observable's structural equality (`isEqual`);
		// subscribers wire the emit side, so the status event is fired
		// exactly once per real transition.
		this.#status.set(next);
	}
}
