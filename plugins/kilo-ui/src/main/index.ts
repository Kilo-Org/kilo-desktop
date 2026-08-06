import path from "node:path";

import type { KiloUiChatService, KiloWorkspaceConnection } from "../contracts/chat/schemas.js";
import type {
	WorkspaceCapabilityService,
	WorkspacesService,
} from "../contracts/workspaces/schemas.js";
import { FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { kiloUiChatContract } from "../contracts/chat/schemas.js";
import { workspacesContract } from "../contracts/workspaces/schemas.js";
import { createWorkspacesDatabase } from "./workspaces/db.js";
import { WorkspaceService } from "./workspaces/WorkspaceService.js";
import { ensureScratchChatDirectory } from "./chat/scratch-directory.js";

type KiloServerCapabilities = {
	connectionService: {
		getConnection(input: { directory: string }): Promise<KiloWorkspaceConnection>;
	};
};

export function mainRegister(mainSdk: MainSdk): void {
	const db = createWorkspacesDatabase(
		path.join(mainSdk.storageDir, "data.db"),
		mainSdk.resolvePluginAsset("drizzle"),
	);
	const service = new WorkspaceService(db);

	const api: WorkspacesService = {
		list: async () => service.list(),
		get: async ({ id }) => service.get(id),
		create: async (input) => {
			const after = service.create(input);
			mainSdk.events.emit("workspace-created", { before: null, after });
			return after;
		},
		update: async ({ id, ...input }) => {
			const before = service.getRequired(id);
			const after = service.update(id, input);
			mainSdk.events.emit("workspace-updated", { before, after });
			return after;
		},
		remove: async ({ id }) => {
			const before = service.remove(id);
			mainSdk.events.emit("workspace-deleted", { before, after: null });
			return { deleted: true };
		},
	};

	const workspaceService = {
		list: () => api.list(),
		get: (id) => api.get({ id }),
		create: (input) => api.create(input),
		update: (input) => api.update(input),
		remove: (id) => api.remove({ id }),
	} satisfies WorkspaceCapabilityService;

	const chatApi: KiloUiChatService = {
		"chat.getConnection": async ({ chatId }) => {
			const connectionService =
				mainSdk.plugins.get<KiloServerCapabilities>("kilo-server")?.connectionService;
			if (!connectionService) {
				throw new FeatureError("Kilo Server is unavailable.", "BUSINESS");
			}
			const directory = await ensureScratchChatDirectory(mainSdk.storageDir, chatId);
			return connectionService.getConnection({ directory });
		},
	};

	mainSdk.plugins.expose("workspaceService", workspaceService);
	mainSdk.channels(workspacesContract).handleAll(api);
	mainSdk.channels(kiloUiChatContract).handleAll(chatApi);
	mainSdk.onDispose(() => db.$client.close());
}
