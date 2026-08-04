import type net from "node:net";

import { app } from "electron";

import { notebookContract } from "@anaconda-agentic-desktop/contracts";
import type { NotebookService } from "@anaconda-agentic-desktop/contracts";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { getDesktopScheme, DESKTOP_HOST } from "../../platform/ElectronProtocol.js";
import { NotebookRelayService } from "./NotebookRelayService.js";
import { RuntimedService, type RuntimedLogger } from "./RuntimedService.js";

export interface NotebookFeatureOptions {
	/** Selects which custom-protocol origin the relay accepts. Defaults to `!app.isPackaged`. */
	readonly isDevelopment?: boolean;
	readonly socketPath?: string;
	readonly logger?: RuntimedLogger;
	/** Test seam for injecting a fake daemon socket factory. */
	readonly connect?: (socketPath: string) => net.Socket;
}

export function mainRegister(mainSdk: MainSdk, options: NotebookFeatureOptions = {}): void {
	const isDevelopment = options.isDevelopment ?? !app.isPackaged;
	const runtimed = new RuntimedService({
		...(options.socketPath ? { socketPath: options.socketPath } : {}),
		...(options.logger ? { logger: options.logger } : {}),
		...(options.connect ? { connect: options.connect } : {}),
	});
	const relay = new NotebookRelayService({
		runtimed,
		allowedOrigin: `${getDesktopScheme(isDevelopment)}://${DESKTOP_HOST}`,
		...(options.logger ? { logger: options.logger } : {}),
	});

	const api: NotebookService = {
		// Starting the relay here rather than at boot keeps the loopback port
		// unbound until something actually opens a notebook.
		status: async () => {
			const relayPort = await relay.start();
			const daemon = await runtimed.queryDaemonInfo();
			return {
				relayPort,
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
	mainSdk.onDispose(() => void relay.dispose());
}
