import { rename, stat } from "node:fs/promises";
import path from "node:path";

import { managedKiloPluginDirectory } from "./managed-kilo-plugins";

/**
 * The agent area's folders under kilo.core's storage directory:
 *
 * - `agent/` is Kilo's XDG state root (`XDG_STATE_HOME`), what kilo.agent's
 *   whole storage directory used to be;
 * - `agent/runtime/` is the server's working directory, with the app-owned
 *   Kilo v2 config (`config/kilo2/`, see `DESKTOP_KILO_CONFIG_FILE`) and
 *   Desktop's managed Kilo plugins (`kilo-plugins/`). Kilo v1's `config/kilo/`
 *   beside it is no longer read;
 * - `agent/external-clients.json` is kilo.agent's saved external AI apps,
 *   adopted once into kilo.core's `agent-external-apps` kv namespace.
 */
export interface AgentDirectories {
	readonly runtimeDirectory: string;
	readonly configDirectory: string;
	readonly managedPluginDirectory: string;
	/** Kilo's XDG state root. */
	readonly stateDirectory: string;
}

export const AGENT_STORAGE_FOLDER = "agent";

/** kilo.agent's storage folder, beside kilo.core's. */
export const KILO_AGENT_STORAGE_FOLDER = "kilo.agent";

/** kilo.agent's kv file of external AI apps, inside the adopted folder. */
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

const exists = (target: string) =>
	stat(target).then(
		() => true,
		() => false,
	);

/**
 * Moves kilo.agent's storage folder into kilo.core's once, so the app-owned
 * Kilo config, Kilo's state, Desktop's Kilo plugins and the paired external
 * apps survive the upgrade. Only a folder kilo.agent actually ran a server in
 * (it has `runtime/`) is taken, and never over a folder kilo.core already has.
 * A rename keeps it atomic: a failed move leaves kilo.agent's folder intact
 * for the next launch.
 */
export async function adoptKiloAgentStorage(storageDirectory: string): Promise<boolean> {
	const target = path.join(storageDirectory, AGENT_STORAGE_FOLDER);
	const legacy = path.join(storageDirectory, "..", KILO_AGENT_STORAGE_FOLDER);
	if (await exists(target)) return false;
	if (!(await exists(path.join(legacy, "runtime")))) return false;
	await rename(legacy, target);
	return true;
}
