import os from "node:os";
import path from "node:path";

import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import { createAgentMainEntry, type ServerInput } from "./agent";
import { createKiloChatClient } from "./conversations";
import { resolveKiloInstallation } from "./installation";
import { KiloServerManager, type KiloInstallation } from "./KiloServerManager";
import { originExternalClientsFile } from "./tool-gateway";

export { createAgentMainEntry } from "./agent";

/**
 * Mirrors the Kilo CLI's `Global.Path.config`, which uses `xdg-basedir` on
 * every platform (Windows included, not `%APPDATA%`). `||` because
 * xdg-basedir treats an empty `XDG_CONFIG_HOME` as unset.
 */
export function resolveUserConfigDirectory(
	env: NodeJS.ProcessEnv = process.env,
	homeDirectory: string = os.homedir(),
): string {
	return path.join(env.XDG_CONFIG_HOME || path.join(homeDirectory, ".config"), "kilo");
}

/**
 * Finds the bundled CLI when the server first spawns, so a missing binary
 * fails the server service (with its message in Diagnostics) instead of
 * failing plugin activation.
 */
function lazyInstallation(sdk: PluginSdk): KiloInstallation {
	let resolved: KiloInstallation | undefined;
	const resolve = () =>
		(resolved ??= resolveKiloInstallation({
			resourceRoots: [mainHost(sdk).assets?.resolve("resources/kilo") ?? ""],
		}));
	return {
		get executablePath() {
			return resolve().executablePath;
		},
		get treeSitterWasmDirectory() {
			return resolve().treeSitterWasmDirectory;
		},
	};
}

function createKiloServer(input: ServerInput, sdk: PluginSdk): KiloServerManager {
	return new KiloServerManager({
		installation: lazyInstallation(sdk),
		...input.directories,
		...(input.installationId !== undefined ? { installationId: input.installationId } : {}),
		corsOrigins: input.corsOrigins,
		allowVersionMismatch: Boolean(process.env.KILO_CODE_CLI_PATH?.trim()),
		fetch: mainHost(sdk).net.fetch,
		logger: sdk.logger,
		onStatusChange: input.onStatusChange,
		contributedEnv: input.contributedEnv,
		webMcpEndpoint: input.webMcpEndpoint,
	});
}

/** kilo.agent's main-process entry: the real Kilo CLI server and its chats, adopting origin's external AI apps once. */
export const agentMainEntry = createAgentMainEntry({
	createServer: createKiloServer,
	createChatClient: createKiloChatClient,
	userConfigDirectory: resolveUserConfigDirectory(),
	originExternalClients: (sdk) => originExternalClientsFile(mainHost(sdk).storage.dir),
});
