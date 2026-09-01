import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import type { CondaEnvironmentRuntime } from "../contracts/capabilities.js";

import { JOB_PROGRESS_LOCAL_EVENT, JobQueue } from "./JobQueue.js";
import { ProviderRegistry } from "./ProviderRegistry.js";
import { CondaRuntime } from "./providers/conda/CondaRuntime.js";
import { CondaProvider } from "./providers/conda/index.js";
import { resolveBridgeLaunchInfo } from "./providers/conda/resolveBridgePath.js";

/**
 * Capability shape exposed by kilo-ui for local MCP App resource registration.
 * Plugins call `register(uri, html)` to make their MCP App HTML available to
 * the MCP Apps renderer without hitting the network.
 */
interface LocalMcpAppsCapability extends Record<string, unknown> {
	localMcpApps: {
		register(uri: string, html: string): void;
		unregister(uri: string): void;
	};
}

/**
 * LaunchDarkly feature-flag key gating the entire environments plugin.
 *
 * When this evaluates to `false` (the default, used when the flag is missing,
 * the provider errors, the user is not in an enabled cohort, or the
 * feature-flag capability itself is unavailable) the environments UI provider
 * does not boot and the conda staging pipeline never runs. The lightweight
 * main-process runtime capability remains available to other plugins and
 * stages conda only when they call it.
 *
 * Kept in sync with the renderer-side constant in
 * `plugins/environments/src/web/EnvironmentsPage.tsx`.
 */
export const FEATURE_FLAG_KEY = "environments-feature";

/**
 * Minimal shape of the main-side feature-flag capability exposed by the
 * shell (see `packages/contracts/src/features/feature-flag-capability.ts`).
 * Inlined so the plugin does not take a `@anaconda-agentic-desktop/contracts`
 * dependency for a single call.
 */
interface FeatureFlagCapability extends Record<string, unknown> {
	featureFlag: {
		getFlag<T>(key: string, defaultValue: T): T;
	};
}

/**
 * Main-process registration for the `environments` plugin.
 *
 * The environments UI provider is gated on the `environments-feature`
 * LaunchDarkly flag. A main-process conda runtime capability is always exposed
 * before the gate so headless consumers can request an isolated environment.
 * Constructing and exposing it performs no I/O; when the flag is off, the
 * bridge is not started until a consumer actually calls `ensureEnvironment`.
 *
 * When enabled: boots registered providers sequentially (staging is one-time,
 * first-launch work), then binds their handlers. Async so the shell can
 * await staging and deliver progress to the splash throughout.
 *
 * A single {@link JobQueue} is created here and shared across every
 * registered provider — sub-issue 5's shared write-serialization + read
 * cache primitive. Every provider's write handlers funnel through
 * `queue.enqueue` (per-provider FIFO + progress events); reads funnel
 * through `queue.read` (5 s TTL cache invalidated on any successful
 * write for the same provider). Job-progress events surface on the SDK
 * event bus under `environments.job-progress`.
 *
 * The gate reads the real LaunchDarkly value at boot because
 * `Application#registerIpc` awaits `FeatureFlagService.initialize()` before
 * `bootFeatures` runs. Flipping the flag while the app is running does NOT
 * re-run staging or dispose of providers — a flag toggle only takes effect
 * on next launch.
 */
export async function mainRegister(mainSdk: MainSdk): Promise<void> {
	const runtime = new CondaRuntime({
		resolveBridge: resolveBridgeLaunchInfo,
		logger: mainSdk.logger,
	});
	const condaRuntime = {
		ensureEnvironment: runtime.ensureEnvironment.bind(runtime),
		executable: runtime.executable.bind(runtime),
	} satisfies CondaEnvironmentRuntime;
	mainSdk.plugins.expose("condaRuntime", condaRuntime);

	const featureFlag = mainSdk.plugins.get<FeatureFlagCapability>("feature-flag");
	const flagEnabled = featureFlag?.featureFlag.getFlag<boolean>(FEATURE_FLAG_KEY, false) ?? false;
	if (!flagEnabled) {
		mainSdk.logger.info("boot skipped: environments-feature flag is off");
		return;
	}

	const registry = new ProviderRegistry();
	registry.register(new CondaProvider());

	const queue = new JobQueue({
		emit: (event) => mainSdk.events.emit(JOB_PROGRESS_LOCAL_EVENT, event),
		logger: mainSdk.logger,
	});
	mainSdk.onDispose(() => queue.dispose());

	for (const provider of registry.list()) {
		if (provider.boot) {
			await provider.boot({ mainSdk, boot: mainSdk.boot, logger: mainSdk.logger });
		}
	}

	// Handlers are registered AFTER all providers have booted so they never
	// serve requests against a not-yet-staged conda binary.
	for (const provider of registry.list()) {
		provider.registerHandlers({ mainSdk, queue });
	}

	// Wire each provider's optional teardown into app shutdown. Without this,
	// a provider holding a long-lived resource (e.g. CondaProvider's
	// SidecarCondaBackend, which spawns the Python bridge) would leak it on a
	// normal app quit — dispose() is otherwise never reached.
	for (const provider of registry.list()) {
		if (provider.onDispose) {
			mainSdk.onDispose(() => provider.onDispose!());
		}
	}

	mainSdk.logger.info(`boot: ${registry.list().length} provider(s) registered`);

	// Register the environments list MCP App HTML with kilo-ui's local
	// resource registry so it renders as an interactive iframe in chat.
	const kiloUi = mainSdk.plugins.get<LocalMcpAppsCapability>("kilo-ui");
	if (kiloUi?.localMcpApps) {
		try {
			const { default: envListAppHtml } = await import("../mcp-app/dist/index.html?raw");
			kiloUi.localMcpApps.register("ui://environments/conda-envs-list", envListAppHtml);
			mainSdk.onDispose(() => kiloUi.localMcpApps.unregister("ui://environments/conda-envs-list"));
			mainSdk.logger.info("mcp-app: registered ui://environments/conda-envs-list");
		} catch (error) {
			mainSdk.logger.warn("mcp-app: failed to load environments MCP App HTML", { error });
		}
	}
}
