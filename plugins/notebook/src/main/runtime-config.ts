import type { KernelLogger } from "@kilo-desktop/kernel";
import type { RuntimeConfig, RuntimeConfigSource } from "@kilo-desktop/plugin-agent/contracts";

/** The notebook tool plugin's id among the Kilo plugins Desktop manages (origin's). */
export const NOTEBOOK_KILO_PLUGIN_ID = "notebooks";

export interface NotebookKiloPluginPaths {
	/** The built notebook tool plugin (`resources/kilo-plugin/index.js`). */
	readonly pluginPath: string | undefined;
	/** The unpacked `@runtimed/node` the tool plugin loads by path. */
	readonly runtimedNodePath: string | undefined;
	readonly socketPath: string;
}

/**
 * What the Kilo server needs for the notebook tools (`notebooks_*`): the
 * notebook tool plugin, and where it finds `@runtimed/node` and the daemon.
 * Without either file the server gets nothing, as origin skipped it.
 */
export function notebookRuntimeConfig(
	paths: NotebookKiloPluginPaths,
	logger: Pick<KernelLogger, "warn">,
): RuntimeConfigSource {
	const { pluginPath, runtimedNodePath, socketPath } = paths;
	const config: RuntimeConfig =
		pluginPath && runtimedNodePath
			? {
					kiloPlugins: { [NOTEBOOK_KILO_PLUGIN_ID]: pluginPath },
					env: {
						NTERACT_RUNTIMED_NODE_PATH: runtimedNodePath,
						RUNTIMED_SOCKET_PATH: socketPath,
					},
				}
			: {};
	if (!pluginPath || !runtimedNodePath) {
		logger.warn(
			"Skipping the notebook Kilo plugin: the plugin bundle or @runtimed/node entry is unavailable.",
		);
	}
	return { read: () => config };
}
