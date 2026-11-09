/**
 * kilo.environments in main: one bundled conda bridge serving the person's
 * conda environments (`kilo.environments/conda`, the conda agent tools) and
 * plugin-owned ones (`kilo.environments/conda-runtime`).
 *
 * Ownership and lifecycle:
 * - The bridge process belongs to the `bridge` kernel service (`first-use`):
 *   every `conda` method asks `kernel/services` to start it, which spawns and
 *   health-checks it once; stopping the service (quit, or a restart from
 *   Diagnostics) releases the process, and the next call starts a new one.
 *   The backend also respawns a bridge that exits on its own, so a failed
 *   start never blocks a later call.
 * - Windows ARM64 gives `conda-runtime` a second bridge with
 *   `CONDA_SUBDIR=win-arm64` (conda has no per-request subdir); elsewhere both
 *   domains share one. The runtime's bridge starts only when an environment
 *   must be created, whatever the flag says.
 * - `conda.status` is `disabled` while the `environments-feature` flag is
 *   off, `unavailable` when no bridge payload is found (looked up once, when
 *   the flag first turns on), else `ready`; methods and tools refuse unless
 *   `ready`. The agent sees no conda tools while it is not (`session-config`).
 * - Writes are serialised and reads cached by one `JobQueue`, whose progress
 *   events are `conda`'s `job-progress`.
 * - Every chat is created with origin's ask rules for mutating conda-family
 *   commands run through `bash` (`session-config` permissions); the mutating
 *   conda tools ask through their own `approval`.
 */
import {
	definePlugin,
	KernelDialogs,
	KernelError,
	KernelService,
	KernelServices,
	mainHost,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Flags } from "@kilo-desktop/plugin-flags/contracts";
import { AgentTool, SessionConfigPoint } from "@kilo-desktop/plugin-agent/contracts";

import {
	BRIDGE_SERVICE_KEY,
	Conda,
	CondaRuntime as CondaRuntimeDomain,
	ENVIRONMENTS_FLAG,
	type CondaStatus,
} from "../contracts/index.js";
import { buildCondaCliPermissionRules, condaToolName } from "../shared/conda-permissions.js";
import { createCondaService, type CondaMethods } from "./conda-service.js";
import { JobQueue } from "./job-queue.js";
import type { CondaBackend } from "./providers/conda/CondaBackend.js";
import { CondaRuntime } from "./providers/conda/CondaRuntime.js";
import {
	type BridgeLaunchInfo,
	resolveBridgeLaunchInfo,
} from "./providers/conda/resolveBridgePath.js";
import {
	bridgePreferences,
	pluginBridgeEnvironment,
	SharedCondaBridge,
	type CondaBridge,
} from "./providers/conda/SharedCondaBridge.js";
import { condaTools } from "./tools.js";

export interface EnvironmentsMainOptions {
	/** Finds the bundled bridge; defaults to the plugin's `resources/bridge` (or `BRIDGE_PAYLOAD`). */
	readonly resolveBridge?: (sdk: PluginSdk) => BridgeLaunchInfo | null;
	/** Creates a bridge holder (tests pass a fake conda runner). */
	readonly createBridge?: (
		sdk: PluginSdk,
		options: {
			readonly resolveBridge: () => BridgeLaunchInfo | null;
			readonly environment?: Readonly<Record<string, string>>;
		},
	) => CondaBridge;
	readonly platform?: NodeJS.Platform;
	readonly arch?: NodeJS.Architecture;
	/** Where plugin-owned environments live; defaults to `~/.kilo-desktop/conda`. */
	readonly condaFilesRoot?: string;
	/**
	 * The bridge's own Sentry DSN (`BRIDGE_SENTRY_DSN`), a build-time constant
	 * per release track. The bridge sends only while `BRIDGE_TELEMETRY_ENABLED`
	 * (data-collection consent) is on.
	 */
	readonly sentryDsn?: string;
}

const UNAVAILABLE_MESSAGES: Readonly<Record<Exclude<CondaStatus, "ready">, string>> = {
	disabled: "Conda Environments is not enabled for this account.",
	unavailable: "Conda Environments is unavailable: the conda bridge payload was not found.",
};

function defaultResolveBridge(sdk: PluginSdk): BridgeLaunchInfo | null {
	const assets = mainHost(sdk).assets;
	let bridgeDir: string | undefined;
	try {
		bridgeDir = assets?.resolve("resources/bridge");
	} catch {
		bridgeDir = undefined;
	}
	return resolveBridgeLaunchInfo({ bridgeDir });
}

/** A backend that acquires the bridge on each call, so a released bridge is replaced. */
function bridgeBackend(bridge: CondaBridge): CondaBackend {
	return new Proxy({} as CondaBackend, {
		get:
			(_target, method: string) =>
			(...args: unknown[]) =>
				(bridge.acquire() as unknown as Record<string, (...input: unknown[]) => unknown>)[method]!(
					...args,
				),
	});
}

export function createEnvironmentsMainEntry(options: EnvironmentsMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const host = mainHost(sdk);
			let launch: BridgeLaunchInfo | null | undefined;
			const resolveLaunch = () => {
				if (launch === undefined) {
					launch = (options.resolveBridge ?? defaultResolveBridge)(sdk);
					if (!launch) sdk.logger.warn("The conda bridge payload was not found.");
				}
				return launch;
			};
			const createBridge =
				options.createBridge ??
				((pluginSdk, bridgeOptions) =>
					new SharedCondaBridge({
						resolveBridge: bridgeOptions.resolveBridge,
						logger: pluginSdk.logger,
						preferences: bridgePreferences(pluginSdk),
						...(bridgeOptions.environment ? { environment: bridgeOptions.environment } : {}),
					}));

			const sentryEnvironment = options.sentryDsn
				? { BRIDGE_SENTRY_DSN: options.sentryDsn }
				: undefined;
			const bridge = createBridge(sdk, {
				resolveBridge: resolveLaunch,
				...(sentryEnvironment ? { environment: sentryEnvironment } : {}),
			});
			sdk.onDispose(() => bridge.dispose());
			const runtimeEnvironment = pluginBridgeEnvironment(
				options.platform ?? process.platform,
				options.arch ?? process.arch,
			);
			const runtimeBridge = runtimeEnvironment
				? createBridge(sdk, {
						resolveBridge: resolveLaunch,
						environment: { ...sentryEnvironment, ...runtimeEnvironment },
					})
				: bridge;
			if (runtimeBridge !== bridge) sdk.onDispose(() => runtimeBridge.dispose());

			const runtime = new CondaRuntime({
				bridge: runtimeBridge,
				logger: sdk.logger,
				...(options.platform ? { platform: options.platform } : {}),
				...(options.condaFilesRoot ? { condaFilesRoot: options.condaFilesRoot } : {}),
			});
			sdk.domains.provide(CondaRuntimeDomain, {
				initialState: {},
				methods: { ensureEnvironment: (input) => runtime.ensureEnvironment(input) },
			});

			const queue = new JobQueue({
				emit: (event) => conda.emit("job-progress", event),
				logger: sdk.logger,
			});
			sdk.onDispose(() => queue.dispose());
			const service = createCondaService({
				backend: bridgeBackend(bridge),
				queue,
				storageDir: () => host.storage.dir,
				pickFile: async () => {
					const dialogs = sdk.domains.get(KernelDialogs);
					if (!dialogs) return null;
					const { paths } = await dialogs.methods.open({
						filters: [{ name: "Environment files", extensions: ["yml", "yaml"] }],
					});
					return paths[0] ?? null;
				},
			});
			sdk.onDispose(() => service.dispose());

			const flagOn = () => sdk.domains.get(Flags)?.getState().flags[ENVIRONMENTS_FLAG] === true;
			const currentStatus = (): CondaStatus => {
				if (!flagOn()) return "disabled";
				return resolveLaunch() ? "ready" : "unavailable";
			};

			const startBridge = async () => {
				const services = sdk.domains.get(KernelServices);
				if (!services) return;
				// A failed start is reported by the service; the call still gets its
				// own chance, since the backend spawns a bridge on demand.
				await services.methods.ensureStarted({ key: BRIDGE_SERVICE_KEY }).catch(() => undefined);
			};

			const assertReady = () => {
				const status = conda.state.status;
				if (status !== "ready") throw new KernelError("UNAVAILABLE", UNAVAILABLE_MESSAGES[status]);
			};
			const methods = Object.fromEntries(
				Object.entries(service)
					.filter(([name]) => name !== "dispose")
					.map(([name, method]) => [
						name,
						async (input: unknown, caller: unknown) => {
							assertReady();
							await startBridge();
							return (method as (input: unknown, caller: unknown) => unknown)(input, caller);
						},
					]),
			) as unknown as CondaMethods;

			const conda = sdk.domains.provide(Conda, {
				initialState: { status: currentStatus() },
				methods,
			});
			const follow = () => {
				const status = currentStatus();
				if (status !== conda.state.status) conda.setState({ status });
			};
			const flags = sdk.domains.get(Flags);
			if (flags) sdk.onDispose(flags.subscribe(follow));

			sdk.extensions.implement(KernelService, "bridge", {
				start: () => bridge.acquire().warmUp(),
				stop: () => bridge.release(),
			});

			const tools = condaTools({
				conda: () => methods,
				openSettings: () => conda.emit("setup-requested", {}),
			});
			for (const [id, tool] of Object.entries(tools)) sdk.extensions.implement(AgentTool, id, tool);

			const toolNames = Object.keys(tools).map(condaToolName);
			const cliRules = buildCondaCliPermissionRules();
			sdk.extensions.implement(SessionConfigPoint, "conda", {
				configure: () => ({
					permissions: cliRules,
					...(conda.state.status === "ready" ? {} : { disableTools: toolNames }),
				}),
			});
		},
	});
}
