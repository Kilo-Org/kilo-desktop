import type { AnacondaMcpStatus } from "@kilo-desktop/contracts";
import {
	ANACONDA_MCP_STATUS_CHANGED,
	type AuthMainCapability,
	type FeatureFlagMainCapability,
} from "@kilo-desktop/contracts";
import type { MainSdk, ObservableValue } from "@kilo-desktop/feature-sdk";
import { createObservableValue } from "@kilo-desktop/feature-sdk";
import type { KiloServerCapabilities } from "@kilo-desktop/plugin-kilo-server/contracts";
import isEqual from "lodash/isEqual.js";

/**
 * Default Anaconda Remote MCP URL (production). Other environments (e.g.
 * `https://stage.anaconda.com/api/mcp`) go through the URL override in the
 * settings panel.
 */
export const DEFAULT_MCP_URL = "https://anaconda.com/api/mcp";

/** Stable MCP server ID persisted in Desktop's owned Kilo config. */
export const MCP_ID = "anaconda-remote";

/** Env var name that Kilo expands in the `{env:VAR}` header template. */
export const MCP_ENV_VAR = "ANACONDA_API_KEY";

/** Source id for the Desktop-owned MCP entry and Kilo server environment contribution. */
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
 * A successful reconcile manages two pieces of state:
 *
 * 1. Persist the MCP entry through `kiloService.configuration` into Desktop's
 *    app-owned `kilo.jsonc`. The Kilo plugin serializes atomic JSONC updates,
 *    preserves unknown entries/comments, and tracks which entries Desktop may
 *    remove. The Authorization header remains an environment template, so the
 *    raw key is never written to disk.
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
	#configuration: KiloServerCapabilities["kiloService"]["configuration"] | null = null;
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
	 * `#envDisposer`, the Desktop-owned config entry, and status transitions.
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
						await this.#teardown();
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
			await this.#teardown();
			this.#setStatus({ state: "disabled" });
			return;
		}

		// 1. If the user turned it off in the settings panel, tear down.
		if (!settings.enabled) {
			await this.#teardown();
			this.#setStatus({ state: "disabled" });
			return;
		}

		// 2. Resolve kilo-server capability.
		const kilo = sdk.plugins.get<KiloServerCapabilities>("kilo-server");
		if (!kilo) {
			await this.#teardown();
			this.#setStatus({ state: "waiting-for-kilo" });
			return;
		}

		// 3. Resolve auth capability and get the API key.
		const auth = sdk.plugins.get<AuthMainCapability>("auth");
		const apiKey = await auth?.session.getApiKey();
		if (!apiKey) {
			await this.#teardown();
			this.#setStatus({ state: "waiting-for-auth" });
			return;
		}

		// 4. Compute desired URL.
		const url = settings.urlOverride ?? DEFAULT_MCP_URL;

		// 5. Persist the Desktop-owned MCP entry and contribute the API key env. Both
		//    paths are idempotent and share Kilo's debounced restart handling.
		await this.#ensureContributions(kilo, url, apiKey);

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

	async #ensureContributions(
		kilo: KiloServerCapabilities,
		url: string,
		apiKey: string,
	): Promise<void> {
		await kilo.kiloService.configuration.set(CONTRIBUTION_SOURCE_ID, {
			mcpEntries: {
				[MCP_ID]: {
					type: "remote",
					url,
					enabled: true,
					headers: { Authorization: `Bearer {env:${MCP_ENV_VAR}}` },
				},
			},
			plugins: {},
		});
		const envDisposer = kilo.kiloService.serverEnv.contribute(CONTRIBUTION_SOURCE_ID, {
			[MCP_ENV_VAR]: apiKey,
		});
		this.#envDisposer = envDisposer;
		this.#configuration = kilo.kiloService.configuration;
	}

	async #teardown(): Promise<void> {
		const configuration =
			this.#configuration ??
			this.#deps.sdk.plugins.get<KiloServerCapabilities>("kilo-server")?.kiloService.configuration;
		this.#configuration = null;
		const envDisposer = this.#envDisposer;
		this.#envDisposer = null;
		try {
			await configuration?.set(CONTRIBUTION_SOURCE_ID, {
				mcpEntries: {},
				plugins: {},
			});
		} finally {
			envDisposer?.();
		}
	}

	#setStatus(next: AnacondaMcpStatus): void {
		// Change-gated by the observable's structural equality (`isEqual`);
		// subscribers wire the emit side, so the status event is fired
		// exactly once per real transition.
		this.#status.set(next);
	}
}
