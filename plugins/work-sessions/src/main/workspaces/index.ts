import { randomUUID } from "node:crypto";
import path from "node:path";

import { KernelError, type DomainObjectProvider, type PluginSdk } from "@kilo-desktop/kernel";

import {
	createWorkspaceInputSchema,
	DEFAULT_WORKSPACE_IDENTITY_COLOR,
	normalizeWorkspaceIdentityColor,
	updateWorkspaceInputSchema,
	Workspaces,
	type Workspace,
	type WorkspaceFolderInput,
	type WorkspacesState,
} from "../../contracts/model";
import { workspacesStore, type PersistedWorkspaces } from "../storage/stores";
import { track } from "../telemetry";
import { authorizePath } from "./authorize";
import { comparablePath, unavailableFolderIds, validateFolders } from "./folders";
import {
	originImportMode,
	recoverable,
	reportOriginImportFailure,
	type SqliteLoader,
} from "../origin-database";
import { readOriginWorkspaces } from "./import-origin";

export interface WorkspacesOptions {
	readonly createId?: () => string;
	readonly now?: () => number;
	/** Origin's kilo-ui database, imported once. */
	readonly originDatabase?: string;
	/** Loads better-sqlite3 for that import. */
	readonly loadSqlite?: SqliteLoader;
	/** How often folder availability is re-checked. */
	readonly folderCheckIntervalMs?: number;
}

const HAS_WORKSPACES = "hasWorkspaces";

const byName = (left: Workspace, right: Workspace) =>
	left.name.localeCompare(right.name, undefined, { sensitivity: "base" });

/**
 * Workspaces in main. They persist in the plugin's kv as one value, so each
 * change is a single atomic write; the domain object mirrors it with folder
 * availability added. Folders are stored canonical (see `validateFolders`),
 * which lets `authorize` compare without re-resolving them. Origin's
 * workspaces are imported once by a task that never overwrites an existing
 * workspace and retries on the next launch if the old database couldn't be
 * read (see `originImportMode` for installs an earlier release wrongly
 * marked imported). Creating and removing a workspace is reported to telemetry with its
 * folder count only, never names or paths.
 */
export function activateWorkspaces(sdk: PluginSdk, options: WorkspacesOptions = {}): void {
	const createId = options.createId ?? randomUUID;
	const now = options.now ?? Date.now;
	const store = workspacesStore(sdk);
	let unavailable: string[] = [];

	const snapshot = (): WorkspacesState => {
		const saved = store.snapshot();
		return {
			workspaces: [...saved.workspaces].sort(byName),
			activeId: saved.activeId,
			unavailableFolderIds: unavailable,
		};
	};
	const workspaces: DomainObjectProvider<typeof Workspaces> = sdk.domainObjects.provide(
		Workspaces,
		{
			initialState: snapshot(),
			methods: {
				create: (input) => create(createWorkspaceInputSchema.parse(input)),
				update: (input) => update(updateWorkspaceInputSchema.parse(input)),
				remove: ({ id }) => remove(id),
				setActive: ({ id }) => {
					if (id !== null && !find(id)) {
						throw new KernelError("VALIDATION", `There is no workspace "${id}".`);
					}
					save({ activeId: id });
				},
				authorize: ({ path: target, rule }) =>
					authorizePath(store.snapshot().workspaces, target, rule),
				checkFolders: () => checkFolders(),
			},
		},
	);

	function publish(): void {
		const state = snapshot();
		workspaces.setState(state);
		sdk.context.set(HAS_WORKSPACES, state.workspaces.length > 0);
	}
	function save(patch: Partial<PersistedWorkspaces>): void {
		store.set(patch);
		publish();
	}
	function find(id: string): Workspace | undefined {
		return store.snapshot().workspaces.find((workspace) => workspace.id === id);
	}

	function resolveName(raw: string | undefined, primary: string, excludeId?: string): string {
		const supplied = raw?.trim();
		if (supplied) return supplied;
		const base = path.basename(primary);
		const taken = new Set(
			store
				.snapshot()
				.workspaces.filter((workspace) => workspace.id !== excludeId)
				.map((workspace) => workspace.name.toLocaleLowerCase()),
		);
		if (!taken.has(base.toLocaleLowerCase())) return base;
		for (let suffix = 2; ; suffix += 1) {
			const candidate = `${base} (${suffix})`;
			if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
		}
	}
	function resolveColor(raw: string | undefined, fallback: string | undefined) {
		if (raw === undefined || !raw.trim()) return fallback;
		const color = normalizeWorkspaceIdentityColor(raw);
		if (!color) throw new KernelError("VALIDATION", "Invalid identity color.");
		return color;
	}
	function folderRecords(folders: readonly WorkspaceFolderInput[], keep?: Workspace) {
		const kept = new Map(keep?.folders.map((folder) => [comparablePath(folder.path), folder.id]));
		return folders.map((folder, position) => ({
			id: kept.get(comparablePath(folder.path)) ?? createId(),
			path: folder.path,
			isPrimary: position === 0,
			position,
		}));
	}

	function create(input: {
		name?: string | undefined;
		color?: string | undefined;
		folders: WorkspaceFolderInput[];
		source?: string | undefined;
	}): Workspace {
		const folders = validateFolders(input.folders);
		const color = resolveColor(input.color, DEFAULT_WORKSPACE_IDENTITY_COLOR);
		const timestamp = now();
		const workspace: Workspace = {
			id: createId(),
			name: resolveName(input.name, folders[0]!.path),
			...(color ? { color } : {}),
			folders: folderRecords(folders),
			createdAt: timestamp,
			updatedAt: timestamp,
		};
		save({ workspaces: [...store.snapshot().workspaces, workspace] });
		workspaces.emit("created", {
			before: null,
			after: workspace,
			...(input.source ? { source: input.source } : {}),
		});
		track(sdk, "workspace-created", {
			...(input.source ? { source: input.source } : {}),
			folderCount: workspace.folders.length,
		});
		void checkFolders();
		return workspace;
	}

	function update(input: {
		id: string;
		name?: string | undefined;
		color?: string | undefined;
		folders: WorkspaceFolderInput[];
	}): Workspace {
		const before = find(input.id);
		if (!before) throw new KernelError("NOT_FOUND", "Workspace not found.");
		const folders = validateFolders(input.folders);
		const color = resolveColor(input.color, before.color);
		const after: Workspace = {
			id: before.id,
			name:
				input.name === undefined
					? before.name
					: resolveName(input.name, folders[0]!.path, before.id),
			...(color ? { color } : {}),
			folders: folderRecords(folders, before),
			createdAt: before.createdAt,
			updatedAt: now(),
		};
		save({
			workspaces: store
				.snapshot()
				.workspaces.map((workspace) => (workspace.id === before.id ? after : workspace)),
		});
		workspaces.emit("updated", { before, after });
		void checkFolders();
		return after;
	}

	function remove(id: string): { deleted: boolean } {
		const before = find(id);
		if (!before) return { deleted: false };
		const saved = store.snapshot();
		const remaining = saved.workspaces.filter((workspace) => workspace.id !== id);
		save({
			workspaces: remaining,
			// The active workspace moves to the next one by name, as origin did.
			activeId:
				saved.activeId === id ? ([...remaining].sort(byName)[0]?.id ?? null) : saved.activeId,
		});
		workspaces.emit("deleted", { before, after: null });
		track(sdk, "workspace-removed", { folderCount: before.folders.length });
		return { deleted: true };
	}

	async function checkFolders(): Promise<void> {
		const next = await unavailableFolderIds(store.snapshot().workspaces);
		if (JSON.stringify(next) === JSON.stringify(unavailable)) return;
		unavailable = next;
		publish();
	}

	publish();
	void checkFolders();
	const folderTimer = setInterval(
		() => void checkFolders(),
		options.folderCheckIntervalMs ?? 30_000,
	);
	folderTimer.unref?.();
	sdk.onDispose(() => clearInterval(folderTimer));

	const mode = originImportMode(store.snapshot());
	if (options.originDatabase && mode !== "done") {
		void importOrigin(sdk, options.originDatabase, options.loadSqlite, (imported) => {
			const current = store.snapshot().workspaces;
			const existing = new Set(current.map((workspace) => workspace.id));
			const merging =
				mode === "import" ||
				recoverable(
					imported.map((workspace) => workspace.id),
					existing,
				);
			const added = merging ? imported.filter((workspace) => !existing.has(workspace.id)) : [];
			save({
				workspaces: [...current, ...added],
				importedFromOrigin: true,
				originImportVerified: true,
			});
			if (added.length > 0) void checkFolders();
		});
	}
}

async function importOrigin(
	sdk: PluginSdk,
	file: string,
	loadDriver: SqliteLoader | undefined,
	merge: (workspaces: Workspace[]) => void,
): Promise<void> {
	try {
		merge(await readOriginWorkspaces(file, loadDriver));
	} catch (error) {
		reportOriginImportFailure(sdk, "workspaces", file, error);
	}
}
