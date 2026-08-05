import type net from "node:net";

import { app } from "electron";

import { notebookContract, NOTEBOOK_HOST } from "@anaconda-agentic-desktop/contracts";
import type { NotebookService } from "@anaconda-agentic-desktop/contracts";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { getDesktopOrigin } from "../../platform/ElectronProtocol.js";
import { createLogger } from "../../platform/logger.js";
import { DaemonProcessService } from "./DaemonProcessService.js";
import { resolveDaemonBinaryPath } from "./daemon-binary-path.js";
import { readBundledDaemonVersion } from "./daemon-version.js";
import { resolveNotebookBundleRoot } from "./notebook-bundle-path.js";
import { CONFIG_PATH, NotebookRelayService } from "./NotebookRelayService.js";
import { RuntimedService, type RuntimedLogger } from "./RuntimedService.js";

export interface NotebookFeatureOptions {
	/** Selects which custom-protocol origin the relay accepts. Defaults to `!app.isPackaged`. */
	readonly isDevelopment?: boolean;
	readonly socketPath?: string;
	readonly logger?: RuntimedLogger;
	/** Test seam for injecting a fake daemon socket factory. */
	readonly connect?: (socketPath: string) => net.Socket;
	/**
	 * Overrides where the sidecar is found. Returning undefined leaves the
	 * feature spawn-free, attaching only to an already-running daemon — which is
	 * what tests outside a real Electron process need, since the default reads
	 * `app.getAppPath()`.
	 */
	readonly resolveDaemonBinary?: () => string | undefined;
	/**
	 * Overrides where the nteract bundle is found, for the same reason as
	 * `resolveDaemonBinary`: the default reads `app.getAppPath()`.
	 */
	readonly resolveBundleRoot?: () => string | undefined;
}

export function mainRegister(mainSdk: MainSdk, options: NotebookFeatureOptions = {}): void {
	const isDevelopment = options.isDevelopment ?? !app.isPackaged;
	const logger = options.logger ?? createLogger("notebook");
	const runtimed = new RuntimedService({
		...(options.socketPath ? { socketPath: options.socketPath } : {}),
		logger,
		...(options.connect ? { connect: options.connect } : {}),
	});
	const relay = new NotebookRelayService({
		runtimed,
		// The WebSocket is opened by nteract's document, which we serve from the
		// notebook host — not the app host. Pointing this at `app` 401s every
		// upgrade, and the view reports that as an unavailable daemon.
		allowedOrigin: getDesktopOrigin(isDevelopment, NOTEBOOK_HOST),
		logger,
	});
	const resolveBinary =
		options.resolveDaemonBinary ??
		(() =>
			resolveDaemonBinaryPath({
				isPackaged: app.isPackaged,
				resourcesPath: process.resourcesPath,
				appPath: app.getAppPath(),
			}));
	const resolveBundleRoot =
		options.resolveBundleRoot ??
		(() =>
			resolveNotebookBundleRoot({
				isPackaged: app.isPackaged,
				resourcesPath: process.resourcesPath,
				appPath: app.getAppPath(),
			}));
	const binaryPath = resolveBinary();
	const daemonProcess = new DaemonProcessService({
		binaryPath,
		probe: () => runtimed.isListening(),
		runningVersion: async () => (await runtimed.queryDaemonInfo())?.version,
		bundledVersion: binaryPath ? () => readBundledDaemonVersion(binaryPath) : async () => undefined,
		logger,
	});

	const api: NotebookService = {
		// Starting the relay and the daemon here rather than at boot keeps the
		// loopback port unbound and the sidecar unspawned until something actually
		// opens a notebook.
		status: async () => {
			const relayPort = await relay.start();
			const process_ = await daemonProcess.ensureRunning();
			// A commit-skewed daemon is reachable but unusable, so it must not be
			// reported as a working daemon — the view would otherwise show a healthy
			// version string for a connection that will corrupt on first frame.
			const daemon = process_.status === "incompatible" ? null : await runtimed.queryDaemonInfo();
			return {
				relayPort,
				process: {
					status: process_.status,
					...("reason" in process_ ? { reason: process_.reason } : {}),
					...(process_.status === "incompatible"
						? {
								runningVersion: process_.runningVersion,
								bundledVersion: process_.bundledVersion,
							}
						: {}),
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
		routes: { [CONFIG_PATH]: () => relay.config() },
	});
	mainSdk.onDispose(() => {
		void daemonProcess.dispose();
		void relay.dispose();
	});
}
