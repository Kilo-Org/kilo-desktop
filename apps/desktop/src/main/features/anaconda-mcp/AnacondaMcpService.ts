import type { AnacondaMcpStatus } from "@anaconda-agentic-desktop/contracts";
import type { AuthMainCapability } from "@anaconda-agentic-desktop/contracts";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk";
import type { KiloServerCapabilities } from "@anaconda-agentic-desktop/plugin-kilo-server/contracts";

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
 * Security invariant: the raw API key NEVER appears in the payload written
 * to kilo.json — only the `{env:ANACONDA_API_KEY}` template is used.
 */
export class AnacondaMcpService {
	#status: AnacondaMcpStatus = { state: "waiting-for-auth" };
	#envDisposer: (() => void) | null = null;
	#mcpConfigured = false;
	#lastConfiguredUrl: string | null = null;
	#lastApiKey: string | null = null;
	#reconciling = false;
	#reconcilePending = false;
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
	 * Prevents interleaved awaits from producing a state that disagrees with
	 * the latest desired settings.
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
	 * Clean up all external state (env contribution + MCP config).
	 * Called on disable, logout, or feature teardown.
	 */
	async dispose(): Promise<void> {
		const kilo = this.#deps.sdk.plugins.get<KiloServerCapabilities>("kilo-server");
		await this.#teardown(kilo);
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
		this.#status = next;
		if (prev.state !== next.state || ("url" in prev && "url" in next && prev.url !== next.url)) {
			this.#deps.sdk.events.emit("status-changed", next);
		}
	}
}
