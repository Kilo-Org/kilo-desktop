import type { ComponentType } from "react";

import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import type { JobQueue } from "./JobQueue.js";

/**
 * Context passed to `EnvironmentProvider.boot`. Providers run any one-time,
 * expensive setup here (staging a bundled runtime, running migrations, …)
 * during the shell's boot window.
 *
 * Boot progress delivered via `boot.reportProgress` is forwarded to the
 * splash window; the hook becomes a silent no-op after `bootFeatures`
 * returns so a slow bootstrap that finishes late cannot push stale UI.
 */
export interface ProviderBootContext {
	/** The plugin's shared main-process SDK, scoped to `environments`. */
	readonly mainSdk: MainSdk;
	/** Convenience shortcut for `mainSdk.boot`. */
	readonly boot: MainSdk["boot"];
	/** Convenience shortcut for `mainSdk.logger`. */
	readonly logger: MainSdk["logger"];
}

/**
 * Context passed to `EnvironmentProvider.registerHandlers`. Providers use
 * `mainSdk.channels(...)` to bind their provider-namespaced handlers
 * (e.g. `conda.envs.list`); the shared {@link JobQueue} serializes
 * writes per-provider and memoises reads for 5 s (sub-issue 5), so
 * every provider funnels its mutating handlers through `queue.enqueue`
 * and its list handlers through `queue.read`.
 */
export interface ProviderRegisterContext {
	/** The plugin's shared main-process SDK, scoped to `environments`. */
	readonly mainSdk: MainSdk;
	/**
	 * Shared write-serialization + read-cache primitive. One instance is
	 * created by `mainRegister` and reused across every provider so all
	 * conda/uv/… jobs share one event stream and one cache-invalidation
	 * boundary.
	 */
	readonly queue: JobQueue;
}

/**
 * Renderer-side component contributions for one provider. The plugin's
 * `EnvironmentsPage` renders the panel components inside a tab labelled with
 * the provider's `displayName`.
 *
 * `SourcesPanel` is generic ("channels" for conda, "index URLs" for uv/pip)
 * and optional so providers without a source concept can omit it.
 */
export interface ProviderWebComponents {
	readonly EnvironmentsPanel: ComponentType;
	readonly PackagesPanel: ComponentType;
	readonly SourcesPanel?: ComponentType;
}

/**
 * The contract every environment manager implements — conda for v1, and any
 * future provider (uv, pip, poetry, hatch, …) that plugs in without
 * touching existing code.
 *
 * Provider-specific concepts (conda channels vs uv/pip index URLs, MatchSpec
 * strings vs PEP 508 requirement strings) live behind this interface; the
 * shared plugin layer (`JobQueue`, cache, event bus, boot-progress hook,
 * `ProviderRegistry`) stays provider-agnostic.
 */
export interface EnvironmentProvider {
	/** Stable id — the first segment of every provider-namespaced tool name (e.g. `conda.envs.list`). */
	readonly id: string;
	/** Human-readable label shown in the provider tab strip. */
	readonly displayName: string;
	/**
	 * Optional boot step. Runs during the shell's boot window; may call
	 * `ctx.boot.reportProgress(message)` to push staging progress to the
	 * splash. Throwing propagates to the boot-failure path.
	 */
	boot?(ctx: ProviderBootContext): Promise<void>;
	/** Bind provider-scoped channels via `ctx.mainSdk.channels(...).handleAll(...)`. */
	registerHandlers(ctx: ProviderRegisterContext): void;
	/** Register provider-scoped WebMCP tools (invoked from the plugin's `webRegister`). */
	registerTools(sdk: SDK): void;
	/** Renderer contribution — panel components mounted inside the provider's tab. */
	readonly webComponents: ProviderWebComponents;
	/** Optional teardown (`mainSdk.onDispose` runs registry-level teardown). */
	onDispose?(): void | Promise<void>;
}

/**
 * Public metadata about a registered provider, delivered to the renderer
 * without leaking component references or handlers across the boundary.
 * Used by `EnvironmentsPage` to render the tab strip.
 */
export interface RegisteredProviderInfo {
	readonly id: string;
	readonly displayName: string;
}
