import type net from "node:net";

import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { notebookContract, NOTEBOOK_HOST, type NotebookService } from "../contracts/schemas.js";
import { resolveNotebookBundleRoot } from "./notebook-bundle-path.js";
import { CONFIG_PATH, NotebookRelayService } from "./NotebookRelayService.js";
import { RuntimedService, type RuntimedLogger } from "./RuntimedService.js";
import type { BuildChannel } from "./socket-path.js";

export const RUNTIMED_PREREQUISITE_MESSAGE =
	"The nteract runtime service is not running. Install or start nteract, then retry.";

export interface NotebookFeatureOptions {
	readonly socketPath?: string;
	/** Selects the installed singleton. Defaults to nightly for the initial demo. */
	readonly runtimeChannel?: BuildChannel;
	readonly logger?: RuntimedLogger;
	/** Test seam for injecting a fake daemon socket factory. */
	readonly connect?: (socketPath: string) => net.Socket;
	readonly resolveBundleRoot?: () => string | undefined;
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
	const checkDaemon = async () =>
		(await runtimed.isListening())
			? ({ status: "available" } as const)
			: ({ status: "unavailable", reason: RUNTIMED_PREREQUISITE_MESSAGE } as const);
	const relay = new NotebookRelayService({
		runtimed,
		// The WebSocket is opened by nteract's document, which we serve from the
		// notebook host — not the app host. Pointing this at `app` 401s every
		// upgrade, and the view reports that as an unavailable daemon.
		checkDaemon,
		logger,
	});

	const api: NotebookService = {
		// Starting the relay here rather than at boot keeps the loopback port
		// unbound until something opens the notebook surface.
		status: async () => {
			const relayPort = await relay.start();
			const daemon = await runtimed.queryDaemonInfo();
			return {
				relayPort,
				availability: daemon
					? { status: "available" as const }
					: { status: "unavailable" as const, reason: RUNTIMED_PREREQUISITE_MESSAGE },
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
	mainSdk.onDispose(() => {
		void relay.dispose();
	});
}
