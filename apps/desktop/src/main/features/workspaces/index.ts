import { existsSync } from "node:fs";
import path from "node:path";

import { workspacesContract } from "@anaconda-agentic-desktop/contracts";
import type { WorkspacesService } from "@anaconda-agentic-desktop/contracts";
import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { createWorkspacesDatabase } from "./db.js";
import { WorkspaceService } from "./WorkspaceService.js";

function migrationsFolder(): string {
	const bundled = path.join(import.meta.dirname, "drizzle", "workspaces");
	if (existsSync(bundled)) return bundled;
	return path.resolve(import.meta.dirname, "../../../../drizzle/workspaces");
}

export function mainRegister(mainSdk: MainSdk): void {
	const db = createWorkspacesDatabase(path.join(mainSdk.storageDir, "data.db"), migrationsFolder());
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
			const before = service.get(id);
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

	mainSdk.plugins.expose("workspaceService", api);
	mainSdk.channels(workspacesContract).handleAll(api);
	mainSdk.onDispose(() => db.$client.close());
}
