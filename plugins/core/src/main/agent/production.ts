import os from "node:os";
import path from "node:path";

import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import type { AgentOptions, ServerInput } from "./index";
import { createKiloChatClient } from "./conversations";
import { resolveKiloInstallation } from "./installation";
import { KiloServerManager, type KiloInstallation } from "./KiloServerManager";
import { originExternalClientsFile } from "./tool-gateway";

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
		get custom() {
			return resolve().custom ?? false;
		},
	};
}

function createKiloServer(input: ServerInput, sdk: PluginSdk): KiloServerManager {
	return new KiloServerManager({
		installation: lazyInstallation(sdk),
		...input.directories,
		...(input.installationId !== undefined ? { installationId: input.installationId } : {}),
		corsOrigins: input.corsOrigins,
		fetch: mainHost(sdk).net.fetch,
		logger: sdk.logger,
		onStatusChange: input.onStatusChange,
		contributedEnv: input.contributedEnv,
		webMcpEndpoint: input.webMcpEndpoint,
	});
}

/** The real Kilo CLI server and its chats, adopting origin's external AI apps once. */
export function productionAgentOptions(sdk: PluginSdk): AgentOptions {
	return {
		createServer: createKiloServer,
		createChatClient: createKiloChatClient,
		// Read when used: activation runs before the login shell's environment
		// (which may set XDG_CONFIG_HOME) is in place.
		get userConfigDirectory() {
			return resolveUserConfigDirectory();
		},
		originExternalClients: originExternalClientsFile(mainHost(sdk).storage.dir),
	};
}
