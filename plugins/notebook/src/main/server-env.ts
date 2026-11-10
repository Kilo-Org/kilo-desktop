import type { KernelLogger } from "@kilo-desktop/kernel";
import type { ServerEnvSource } from "@kilo-desktop/plugin-core/contracts";

import { NOTEBOOK_SERVER_ENV } from "../contracts/index.js";

export interface NotebookServerEnvPaths {
	/** The unpacked `@runtimed/node` the notebook Kilo plugin loads by path. */
	readonly runtimedNodePath: string | undefined;
	readonly socketPath: string;
}

/**
 * Where the notebook Kilo plugin (`notebooks_*` tools) finds `@runtimed/node`
 * and the daemon, for the Kilo server's environment. Without the runtimed
 * node entry the server gets nothing, as origin skipped it.
 */
export function notebookServerEnv(
	paths: NotebookServerEnvPaths,
	logger: Pick<KernelLogger, "warn">,
): ServerEnvSource {
	const { runtimedNodePath, socketPath } = paths;
	if (!runtimedNodePath) {
		logger.warn("Skipping the notebook Kilo plugin: the @runtimed/node entry is unavailable.");
		return { read: () => ({}) };
	}
	const env = {
		[NOTEBOOK_SERVER_ENV.runtimedNodePath]: runtimedNodePath,
		[NOTEBOOK_SERVER_ENV.socketPath]: socketPath,
	};
	return { read: () => env };
}
