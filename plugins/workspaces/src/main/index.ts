import path from "node:path";

import type { WorkspaceCapabilityService, WorkspacesService } from "../contracts/schemas.js";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { workspacesContract } from "../contracts/schemas.js";
import { createWorkspacesDatabase } from "./db.js";
import { WorkspaceService } from "./WorkspaceService.js";

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

	mainSdk.plugins.expose("workspaceService", workspaceService);
	mainSdk.channels(workspacesContract).handleAll(api);
	mainSdk.onDispose(() => db.$client.close());
}
