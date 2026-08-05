import type net from "node:net";

import { app } from "electron";

import { notebookContract } from "@anaconda-agentic-desktop/contracts";
import type { NotebookService } from "@anaconda-agentic-desktop/contracts";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { getDesktopScheme, DESKTOP_HOST } from "../../platform/ElectronProtocol.js";
import { createLogger } from "../../platform/logger.js";
import { DaemonProcessService } from "./DaemonProcessService.js";
import { resolveDaemonBinaryPath } from "./daemon-binary-path.js";
import { NotebookRelayService } from "./NotebookRelayService.js";
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
		allowedOrigin: `${getDesktopScheme(isDevelopment)}://${DESKTOP_HOST}`,
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
	const daemonProcess = new DaemonProcessService({
		binaryPath: resolveBinary(),
		probe: () => runtimed.isListening(),
		logger,
	});

	const api: NotebookService = {
		// Starting the relay and the daemon here rather than at boot keeps the
		// loopback port unbound and the sidecar unspawned until something actually
		// opens a notebook.
		status: async () => {
			const relayPort = await relay.start();
			const process_ = await daemonProcess.ensureRunning();
			const daemon = await runtimed.queryDaemonInfo();
			return {
				relayPort,
				process: {
					status: process_.status,
					...("reason" in process_ ? { reason: process_.reason } : {}),
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
	mainSdk.onDispose(() => {
		void daemonProcess.dispose();
		void relay.dispose();
	});
}
