import path from "node:path";

import { managedKiloPluginDirectory } from "./managed-kilo-plugins";

/**
 * The agent area's folders under kilo.core's storage directory, which the v1
 * and v2 builds share because storage is keyed by plugin id. The v2 line keeps
 * everything under `agent-v2/`, apart from v1's `agent/`, so a v2 build never
 * reads or moves v1 state, and it never adopts kilo.agent's old folder (that
 * holds v1 state too):
 *
 * - `agent-v2/` is Kilo's XDG state root (`XDG_STATE_HOME`);
 * - `agent-v2/runtime/` is the server's working directory, with the app-owned
 *   Kilo v2 config directory (`config/kilo2`, passed as `KILO2_CONFIG_DIR`)
 *   and Desktop's managed Kilo plugins (`kilo-plugins/`);
 * - kilo.agent's external AI apps file is looked up in `agent-v2/` too, so a
 *   v2 build never adopts the one beside v1's state.
 */
export interface AgentDirectories {
	readonly runtimeDirectory: string;
	readonly configDirectory: string;
	readonly managedPluginDirectory: string;
	/** Kilo's XDG state root. */
	readonly stateDirectory: string;
}

export const AGENT_STORAGE_FOLDER = "agent-v2";

/** kilo.agent's kv file of external AI apps, inside the agent folder. */
export const KILO_AGENT_EXTERNAL_APPS_FILE = "external-clients.json";

export function agentDirectories(storageDirectory: string): AgentDirectories {
	const stateDirectory = path.join(storageDirectory, AGENT_STORAGE_FOLDER);
	const runtimeDirectory = path.join(stateDirectory, "runtime");
	return {
		runtimeDirectory,
		configDirectory: path.join(runtimeDirectory, "config", "kilo2"),
		managedPluginDirectory: managedKiloPluginDirectory(runtimeDirectory),
		stateDirectory,
	};
}
