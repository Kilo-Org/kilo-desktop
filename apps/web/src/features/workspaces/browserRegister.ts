import type {
	Workspace,
	WorkspaceFolderInput,
	WorkspacesService,
} from "@anaconda-agentic-desktop/contracts";
import { workspacesContract } from "@anaconda-agentic-desktop/contracts";
import { FeatureError, type MainSdk } from "@anaconda-agentic-desktop/feature-sdk";

const basename = (folderPath: string) =>
	folderPath
		.replace(/[\\/]+$/, "")
		.split(/[\\/]/)
		.at(-1) || "Workspace";

export function workspacesBrowserRegister(mainSdk: MainSdk): void {
	let workspaces: Workspace[] = [];

	const validate = (folders: WorkspaceFolderInput[]) => {
		if (folders.length === 0 || folders.filter((folder) => folder.isPrimary).length !== 1) {
			throw new FeatureError("A workspace needs exactly one primary folder.", "VALIDATION");
		}
		const paths = folders.map((folder) => folder.path);
		if (new Set(paths).size !== paths.length) {
			throw new FeatureError("Workspace folders must be unique.", "VALIDATION");
		}
		const primary = folders.find((folder) => folder.isPrimary)!;
		return [primary, ...folders.filter((folder) => !folder.isPrimary)];
	};

	const resolveName = (rawName: string | undefined, primaryPath: string, excludeId?: string) => {
		const supplied = rawName?.trim();
		if (supplied) return supplied;
		const base = basename(primaryPath);
		const occupied = new Set(
			workspaces
				.filter((workspace) => workspace.id !== excludeId)
				.map((workspace) => workspace.name.toLocaleLowerCase()),
		);
		if (!occupied.has(base.toLocaleLowerCase())) return base;
		for (let suffix = 2; ; suffix += 1) {
			const candidate = `${base} (${suffix})`;
			if (!occupied.has(candidate.toLocaleLowerCase())) return candidate;
		}
	};

	const find = (id: string) => {
		const workspace = workspaces.find((candidate) => candidate.id === id);
		if (!workspace) throw new FeatureError("Workspace not found.", "NOT_FOUND");
		return workspace;
	};

	const service: WorkspacesService = {
		list: async () =>
			[...workspaces].sort((a, b) =>
				a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
			),
		get: async ({ id }) => find(id),
		create: async (input) => {
			const folders = validate(input.folders);
			const timestamp = Date.now();
			const after: Workspace = {
				id: crypto.randomUUID(),
				name: resolveName(input.name, folders[0]!.path),
				folders: folders.map((folder, position) => ({
					id: crypto.randomUUID(),
					path: folder.path,
					isPrimary: position === 0,
					position,
				})),
				createdAt: timestamp,
				updatedAt: timestamp,
			};
			workspaces.push(after);
			mainSdk.events.emit("workspace-created", { before: null, after });
			return after;
		},
		update: async ({ id, ...input }) => {
			const before = find(id);
			const folders = validate(input.folders);
			const ids = new Map(before.folders.map((folder) => [folder.path, folder.id]));
			const after: Workspace = {
				...before,
				name:
					input.name === undefined ? before.name : resolveName(input.name, folders[0]!.path, id),
				folders: folders.map((folder, position) => ({
					id: ids.get(folder.path) ?? crypto.randomUUID(),
					path: folder.path,
					isPrimary: position === 0,
					position,
				})),
				updatedAt: Date.now(),
			};
			workspaces = workspaces.map((workspace) => (workspace.id === id ? after : workspace));
			mainSdk.events.emit("workspace-updated", { before, after });
			return after;
		},
		remove: async ({ id }) => {
			const before = find(id);
			workspaces = workspaces.filter((workspace) => workspace.id !== id);
			mainSdk.events.emit("workspace-deleted", { before, after: null });
			return { deleted: true };
		},
	};

	mainSdk.plugins.expose("workspaceService", service);
	mainSdk.channels(workspacesContract).handleAll(service);
}
