import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
	kiloCodeContract,
	type KiloCodeService,
	type KiloGetConnectionInput,
	type KiloServerConnection,
	type KiloServerStatus,
} from "../contracts/schemas.js";
import { FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { KiloServerManager, type KiloServerManagerOptions } from "./KiloServerManager.js";
import { resolveKiloInstallation } from "./installation.js";
import type { WorkspaceCapabilities } from "./workspace-capability.js";

/** Per-chat scratch directory for unscoped chats: `{storageDir}/chats/<chatId>/`. */
export function unscopedChatDirectory(storageDir: string, chatId: string): string {
	const chatsRoot = path.resolve(storageDir, "chats");
	const directory = path.resolve(chatsRoot, chatId);
	const relative = path.relative(chatsRoot, directory);
	if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new FeatureError("Invalid chat id.", "VALIDATION");
	}
	return directory;
}

export interface KiloServerController {
	readonly status: KiloServerStatus;
	ensureRunning(): Promise<KiloServerConnection>;
	restart(): Promise<KiloServerConnection>;
	dispose(): void;
}

interface RegisterKiloCodeOptions {
	createServer?: (onStatusChange: (status: KiloServerStatus) => void) => KiloServerController;
}

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

export function registerKiloCode(mainSdk: MainSdk, options: RegisterKiloCodeOptions = {}): void {
	const createServer =
		options.createServer ??
		((onStatusChange: (status: KiloServerStatus) => void) =>
			new KiloServerManager(createKiloServerManagerOptions(mainSdk, onStatusChange)));
	const server = createServer((status) => mainSdk.events.emit("server-status-changed", status));
	// The manager records and emits startup failures; keep app initialization alive so a later
	// connection request can retry without producing an unhandled rejection here.
	void server.ensureRunning().catch(() => undefined);

	const resolveDirectory = async (input: KiloGetConnectionInput): Promise<string> => {
		if ("workspaceId" in input) {
			const workspaceService =
				mainSdk.plugins.get<WorkspaceCapabilities>("workspaces")?.workspaceService;
			if (!workspaceService) {
				throw new FeatureError("Workspaces are unavailable.", "BUSINESS");
			}
			const workspace = await workspaceService.get(input.workspaceId);
			if (!workspace) throw new FeatureError("Workspace not found.", "NOT_FOUND");
			const primaryFolder = workspace.folders.find((folder) => folder.isPrimary);
			if (!primaryFolder) {
				throw new FeatureError("Workspace has no primary folder.", "BUSINESS");
			}
			return primaryFolder.path;
		}
		const directory = unscopedChatDirectory(mainSdk.storageDir, input.chatId);
		await mkdir(directory, { recursive: true });
		return directory;
	};

	const service: KiloCodeService = {
		"server.getConnection": async (input) => {
			const directory = await resolveDirectory(input);
			const connection = await server.ensureRunning();
			return { ...connection, directory };
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
