import path from "node:path";

import type { KiloGlobalConnection, KiloUiChatService } from "../contracts/chat/schemas.js";
import type { OnboardingService } from "../contracts/onboarding/schemas.js";
import type {
	WorkspaceCapabilityService,
	WorkspacesService,
} from "../contracts/workspaces/schemas.js";
import { FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { kiloUiChatContract } from "../contracts/chat/schemas.js";
import { onboardingContract } from "../contracts/onboarding/schemas.js";
import { workspacesContract } from "../contracts/workspaces/schemas.js";
import { OnboardingStore } from "./onboarding/OnboardingStore.js";
import { createWorkspacesDatabase } from "./workspaces/db.js";
import { WorkspaceService } from "./workspaces/WorkspaceService.js";
import { createUnscopedChatDirectory } from "./chat/unscoped-chat-directory.js";
import { createWorkspaceSessionUnscoper } from "./chat/unscope-workspace-sessions.js";

type KiloServerCapabilities = {
	connectionService: {
		getConnection(): Promise<KiloGlobalConnection>;
	};
};

export function mainRegister(
	mainSdk: MainSdk,
	options: { unscopeWorkspaceSessions?: (workspaceId: string) => Promise<void> } = {},
): void {
	const db = createWorkspacesDatabase(
		path.join(mainSdk.storageDir, "data.db"),
		mainSdk.resolvePluginAsset("drizzle"),
	);
	const service = new WorkspaceService(db);
	const unscopeWorkspaceSessions =
		options.unscopeWorkspaceSessions ?? createWorkspaceSessionUnscoper(mainSdk);

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
			await unscopeWorkspaceSessions(id);
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
		"chat.getConnection": async () => {
			const connectionService =
				mainSdk.plugins.get<KiloServerCapabilities>("kilo-server")?.connectionService;
			if (!connectionService) {
				throw new FeatureError("Kilo Server is unavailable.", "BUSINESS");
			}
			return connectionService.getConnection();
		},
		"chat.prepareSession": async ({ workspaceId }) => {
			if (workspaceId) {
				const workspace = service.get(workspaceId);
				if (!workspace) {
					throw new FeatureError("Workspace not found.", "NOT_FOUND");
				}
				const primary = workspace.folders.find((folder) => folder.isPrimary);
				if (!primary) {
					throw new FeatureError("Workspace has no primary folder.", "BUSINESS");
				}
				return {
					directory: primary.path,
					workspaceId,
					workspaceFolders: workspace.folders.map(({ path, isPrimary }) => ({
						path,
						isPrimary,
					})),
				};
			}
			return {
				directory: await createUnscopedChatDirectory(mainSdk.storageDir),
				workspaceFolders: [],
			};
		},
	};

	const onboarding = new OnboardingStore(mainSdk);
	const onboardingApi: OnboardingService = {
		"onboarding.get": async () => onboarding.get(),
		"onboarding.complete": async () => onboarding.complete(),
		"onboarding.skip": async () => onboarding.skip(),
	};

	mainSdk.plugins.expose("workspaceService", workspaceService);
	mainSdk.channels(workspacesContract).handleAll(api);
	mainSdk.channels(kiloUiChatContract).handleAll(chatApi);
	mainSdk.channels(onboardingContract).handleAll(onboardingApi);
	mainSdk.onDispose(() => db.$client.close());
}
