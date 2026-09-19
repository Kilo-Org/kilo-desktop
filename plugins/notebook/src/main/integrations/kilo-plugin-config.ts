import type { MainSdk } from "@kilo-desktop/feature-sdk/main";

const SOURCE_ID = "notebook";
const PLUGIN_ID = "notebooks";

type KiloService = {
	configuration: {
		set(
			sourceId: string,
			desired: {
				plugins: Readonly<Record<string, string>>;
				mcpEntries: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
			},
		): Promise<void>;
	};
	serverEnv: {
		contribute(sourceId: string, env: Record<string, string>): () => void;
	};
};

type KiloServerCapabilities = {
	kiloService: KiloService;
};

export interface ReconcileNotebookKiloPluginOptions {
	readonly pluginPath: string;
	readonly runtimedNodePath: string;
	readonly socketPath: string;
	readonly logger?: Pick<MainSdk["logger"], "warn">;
}

/**
 * Reconciles the in-process notebook tool plugin as the notebook feature's
 * complete Kilo state. The Kilo configuration module installs desired state
 * before pruning previously owned state, preserving the old path as a fallback
 * if plugin installation fails.
 * The returned disposer owns only the Kilo child environment contribution;
 * the managed plugin remains installed for the next lazy server start.
 */
export async function reconcileNotebookKiloPlugin(
	mainSdk: MainSdk,
	options: ReconcileNotebookKiloPluginOptions,
): Promise<() => void> {
	const logger = options.logger ?? mainSdk.logger;
	const service = mainSdk.plugins.get<KiloServerCapabilities>("kilo-server")?.kiloService;
	if (!service?.configuration || !service.serverEnv) {
		logger.warn(
			"Skipping notebook Kilo plugin configuration: kilo-server capability is unavailable.",
		);
		return () => undefined;
	}

	await service.configuration.set(SOURCE_ID, {
		plugins: { [PLUGIN_ID]: options.pluginPath },
		mcpEntries: {},
	});
	const disposeEnvironment = service.serverEnv.contribute(SOURCE_ID, {
		NTERACT_RUNTIMED_NODE_PATH: options.runtimedNodePath,
		RUNTIMED_SOCKET_PATH: options.socketPath,
	});
	return disposeEnvironment;
}
