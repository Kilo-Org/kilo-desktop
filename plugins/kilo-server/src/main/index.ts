import path from "node:path";

import {
	kiloServerContract,
	type KiloServerService,
	type KiloServerConnection,
	type KiloServerStatus,
} from "../contracts/schemas.js";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { KiloServerManager, type KiloServerManagerOptions } from "./KiloServerManager.js";
import { resolveKiloInstallation } from "./installation.js";

export interface KiloServerController {
	readonly status: KiloServerStatus;
	ensureRunning(): Promise<KiloServerConnection>;
	restart(): Promise<KiloServerConnection>;
	dispose(): void;
}

interface RegisterKiloServerOptions {
	createServer?: (onStatusChange: (status: KiloServerStatus) => void) => KiloServerController;
}

export type KiloServerCapabilities = {
	connectionService: {
		getConnection(): Promise<KiloServerConnection>;
	};
};

export function createKiloServerManagerOptions(
	mainSdk: MainSdk,
	onStatusChange: (status: KiloServerStatus) => void,
	resolveInstallation: typeof resolveKiloInstallation = resolveKiloInstallation,
): KiloServerManagerOptions {
	return {
		installation: resolveInstallation({
			resourceRoots: [mainSdk.resolvePluginAsset("resources/kilo")],
		}),
		runtimeDirectory: path.join(mainSdk.storageDir, "runtime"),
		allowVersionMismatch: Boolean(process.env.KILO_CODE_CLI_PATH?.trim()),
		fetch: mainSdk.net.fetch,
		logger: mainSdk.logger,
		onStatusChange,
	};
}

export function registerKiloServer(
	mainSdk: MainSdk,
	options: RegisterKiloServerOptions = {},
): void {
	const createServer =
		options.createServer ??
		((onStatusChange: (status: KiloServerStatus) => void) =>
			new KiloServerManager(createKiloServerManagerOptions(mainSdk, onStatusChange)));
	const server = createServer((status) => mainSdk.events.emit("server-status-changed", status));
	// The manager records and emits startup failures; keep app initialization alive so a later
	// connection request can retry without producing an unhandled rejection here.
	void server.ensureRunning().catch(() => undefined);

	const connectionService = {
		getConnection: async () => server.ensureRunning(),
	} satisfies KiloServerCapabilities["connectionService"];

	const service: KiloServerService = {
		"server.getConnection": connectionService.getConnection,
		"server.restart": async () => server.restart(),
		"server.status": async () => server.status,
	};

	mainSdk.plugins.expose("connectionService", connectionService);
	mainSdk.channels(kiloServerContract).handleAll(service);
	mainSdk.onDispose(() => server.dispose());
}

export function mainRegister(mainSdk: MainSdk): void {
	registerKiloServer(mainSdk);
}
