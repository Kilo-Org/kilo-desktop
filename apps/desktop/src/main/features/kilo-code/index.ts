import path from "node:path";

import {
	kiloCodeContract,
	type KiloCodeService,
	type KiloServerConnection,
	type KiloServerStatus,
} from "@anaconda-agentic-desktop/contracts";
import { FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { KiloServerManager } from "./KiloServerManager.js";
import { getBuiltInKiloResourceRoots } from "./builtInAssets.js";
import { resolveKiloInstallation } from "./installation.js";
import type { WorkspaceCapabilities } from "./workspace-capability.js";

export interface KiloServerController {
	readonly status: KiloServerStatus;
	ensureRunning(): Promise<KiloServerConnection>;
	restart(): Promise<KiloServerConnection>;
	dispose(): void;
}

interface RegisterKiloCodeOptions {
	createServer?: (onStatusChange: (status: KiloServerStatus) => void) => KiloServerController;
}

export function registerKiloCode(mainSdk: MainSdk, options: RegisterKiloCodeOptions = {}): void {
	const createServer =
		options.createServer ??
		((onStatusChange: (status: KiloServerStatus) => void) =>
			new KiloServerManager({
				installation: resolveKiloInstallation({
					resourceRoots: getBuiltInKiloResourceRoots(),
				}),
				runtimeDirectory: path.join(mainSdk.storageDir, "runtime"),
				allowVersionMismatch: Boolean(process.env.KILO_CODE_CLI_PATH?.trim()),
				onStatusChange,
			}));
	const server = createServer((status) => mainSdk.events.emit("server-status-changed", status));
	// The manager records and emits startup failures; keep app initialization alive so a later
	// connection request can retry without producing an unhandled rejection here.
	void server.ensureRunning().catch(() => undefined);

	const service: KiloCodeService = {
		"server.getConnection": async ({ workspaceId }) => {
			const workspaceService =
				mainSdk.plugins.get<WorkspaceCapabilities>("workspaces")?.workspaceService;
			if (!workspaceService) {
				throw new FeatureError("Workspaces are unavailable.", "BUSINESS");
			}
			const workspace = await workspaceService.get(workspaceId);
			if (!workspace) throw new FeatureError("Workspace not found.", "NOT_FOUND");
			const primaryFolder = workspace.folders.find((folder) => folder.isPrimary);
			if (!primaryFolder) {
				throw new FeatureError("Workspace has no primary folder.", "BUSINESS");
			}
			const connection = await server.ensureRunning();
			return { ...connection, directory: primaryFolder.path };
		},
		"server.restart": async () => server.restart(),
		"server.status": async () => server.status,
	};

	mainSdk.channels(kiloCodeContract).handleAll(service);
	mainSdk.onDispose(() => server.dispose());
}

export function mainRegister(mainSdk: MainSdk): void {
	registerKiloCode(mainSdk);
}
