import type { ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import type net from "node:net";

import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { notebookContract, NOTEBOOK_HOST, type NotebookService } from "../contracts/schemas.js";
import { DaemonProcessService, daemonUnavailableReason } from "./DaemonProcessService.js";
import { getRuntimedArtifact } from "./distribution/artifacts.js";
import { resolveNotebookBundleRoot } from "./notebook-bundle-path.js";
import { CONFIG_PATH, NotebookRelayService } from "./NotebookRelayService.js";
import { RuntimedService, type RuntimedLogger } from "./RuntimedService.js";
import { registerRuntMcpSeed } from "./seed-runt-mcp.js";
import type { BuildChannel } from "./socket-path.js";

export interface NotebookFeatureOptions {
	readonly socketPath?: string;
	/** Selects the installed singleton. Defaults to nightly for the initial demo. */
	readonly runtimeChannel?: BuildChannel;
	readonly logger?: RuntimedLogger;
	/** Test seam for injecting a fake daemon socket factory. */
	readonly connect?: (socketPath: string) => net.Socket;
	readonly resolveBundleRoot?: () => string | undefined;
	readonly resolveDaemonBinary?: () => string | undefined;
	readonly resolveRuntBinary?: () => string | undefined;
	readonly spawnProcess?: (binaryPath: string) => ChildProcess;
	readonly daemonOptions?: Partial<
		Pick<
			ConstructorParameters<typeof DaemonProcessService>[0],
			| "sleep"
			| "now"
			| "readyTimeoutMs"
			| "pollIntervalMs"
			| "shutdownGraceMs"
			| "maxRestartAttempts"
			| "stableUptimeMs"
		>
	>;
}

export function mainRegister(mainSdk: MainSdk, options: NotebookFeatureOptions = {}): void {
	const logger = options.logger ?? mainSdk.logger;
	const runtimed = new RuntimedService({
		...(options.socketPath ? { socketPath: options.socketPath } : {}),
		...(options.runtimeChannel ? { channel: options.runtimeChannel } : {}),
		logger,
		...(options.connect ? { connect: options.connect } : {}),
	});
	const resolveBundleRoot =
		options.resolveBundleRoot ??
		(() => resolveNotebookBundleRoot({ candidate: mainSdk.resolvePluginAsset("build/notebook") }));
	const resolveDaemonBinary =
		options.resolveDaemonBinary ??
		(() => {
			const artifact = getRuntimedArtifact();
			const candidate = mainSdk.resolvePluginAsset(
				`resources/runtimed/${artifact.target}/${artifact.executable}`,
			);
			return existsSync(candidate) ? candidate : undefined;
		});
	const daemonBinary = resolveDaemonBinary();
	const daemonProcess = new DaemonProcessService({
		...(daemonBinary ? { binaryPath: daemonBinary } : {}),
		probe: () => runtimed.isListening(),
		logger,
		...(options.spawnProcess ? { spawnProcess: options.spawnProcess } : {}),
		...options.daemonOptions,
	});
	const checkDaemon = async () => {
		const state = await daemonProcess.ensureRunning();
		return state.status === "running" || state.status === "external"
			? ({ status: "available" } as const)
			: ({ status: "unavailable", reason: daemonUnavailableReason(state) } as const);
	};
	const relay = new NotebookRelayService({
		runtimed,
		// The WebSocket is opened by nteract's document, which we serve from the
		// notebook host — not the app host. Pointing this at `app` 401s every
		// upgrade, and the view reports that as an unavailable daemon.
		checkDaemon,
		logger,
	});

	registerRuntMcpSeed(mainSdk, {
		socketPath: runtimed.socketPath,
		logger,
		...(options.resolveRuntBinary ? { resolveRuntBinary: options.resolveRuntBinary } : {}),
	});

	const api: NotebookService = {
		// Starting the relay here rather than at boot keeps the loopback port
		// unbound until something opens the notebook surface.
		status: async () => {
			const relayPort = await relay.start();
			const availability = await checkDaemon();
			const daemon = await runtimed.queryDaemonInfo();
			return {
				relayPort,
				availability: daemon
					? { status: "available" as const }
					: availability.status === "unavailable"
						? availability
						: {
								status: "unavailable" as const,
								reason: "The notebook service started but did not return daemon information.",
							},
				daemon: daemon
					? {
							version: daemon.version,
							socketPath: daemon.socket_path,
							isDevMode: daemon.is_dev_mode,
							blobPort: daemon.blob_port,
						}
					: null,
			};
		},
	};

	mainSdk.channels(notebookContract).handleAll(api);
	// The platform reads this back generically (collectEmbeddedHosts) and owns the
	// CSP it is served under, so no feature name reaches platform/ (D2, D3).
	// `relay.config()` starts the relay on demand, which is why serving assets
	// does not bind the loopback port but fetching the config does.
	mainSdk.plugins.expose("embeddedWebHost", {
		host: NOTEBOOK_HOST,
		root: resolveBundleRoot(),
		routes: { [CONFIG_PATH]: ({ origin }: { origin: string }) => relay.config(origin) },
	});
	mainSdk.onDispose(async () => {
		await relay.dispose();
		await daemonProcess.dispose();
	});
}
