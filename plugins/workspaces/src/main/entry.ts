import { randomUUID } from "node:crypto";
import path from "node:path";

import pLimit from "p-limit";

import {
	definePlugin,
	KernelError,
	KernelService,
	mainHost,
	type DomainProvider,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import {
	createWorkspaceInputSchema,
	DEFAULT_WORKSPACE_IDENTITY_COLOR,
	Files,
	normalizeWorkspaceIdentityColor,
	updateWorkspaceInputSchema,
	Vcs,
	Workspaces,
	type Workspace,
	type WorkspaceFolderInput,
	type WorkspacesState,
} from "../contracts";
import { authorizePath } from "./authorize";
import { comparablePath, unavailableFolderIds, validateFolders } from "./folders";
import { readOriginWorkspaces } from "./import-origin";
import { WorkspaceWatcher, type WatchSubscribeFn } from "./watcher/workspace-watcher";

interface Persisted extends Record<string, unknown> {
	workspaces: Workspace[];
	activeId: string | null;
	/** Set once origin's workspaces have been read (or there were none to read). */
	importedFromOrigin: boolean;
}

export interface WatchOptions {
	readonly subscribeFn: WatchSubscribeFn;
	readonly realpath: (path: string) => string | Promise<string>;
	readonly retryDelayMs?: number;
}

export interface WorkspacesMainOptions {
	readonly createId?: () => string;
	readonly now?: () => number;
	/** Origin's kilo-ui database, imported once. */
	readonly originDatabase?: string | ((sdk: PluginSdk) => string);
	/** The file watcher's backend; `false` leaves the watcher out (tests of the store). */
	readonly watch: WatchOptions | false;
	/** How often folder availability is re-checked. */
	readonly folderCheckIntervalMs?: number;
}

const HAS_WORKSPACES = "hasWorkspaces";
const VCS = "vcs";

const byName = (left: Workspace, right: Workspace) =>
	left.name.localeCompare(right.name, undefined, { sensitivity: "base" });

/**
 * kilo.workspaces in main. Workspaces persist in the plugin's kv as one
 * value, so each change is a single atomic write; the domain object mirrors
 * it with folder availability added. Folders are stored canonical (see
 * `validateFolders`), which lets `authorize` compare without re-resolving
 * them. Origin's workspaces are imported once by a task that never
 * overwrites an existing workspace and retries on the next launch if the old
 * database couldn't be read. The file watcher is a daemon that watches the
 * union of every workspace's folders and re-reconciles whenever it changes.
 * The `vcs` key follows whoever implements the `vcs` point.
 */
export function createWorkspacesMainEntry(options: WorkspacesMainOptions): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const createId = options.createId ?? randomUUID;
			const now = options.now ?? Date.now;
			const store = mainHost(sdk).storage.kv<Persisted>({
				namespace: "workspaces",
				defaults: { workspaces: [], activeId: null, importedFromOrigin: false },
			});
			let unavailable: string[] = [];

			const snapshot = (): WorkspacesState => {
				const saved = store.snapshot();
				return {
					workspaces: [...saved.workspaces].sort(byName),
					activeId: saved.activeId,
					unavailableFolderIds: unavailable,
				};
			};
			const workspaces: DomainProvider<typeof Workspaces> = sdk.domains.provide(Workspaces, {
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
			});

			function publish(): void {
				const state = snapshot();
				workspaces.setState(state);
				sdk.context.set(HAS_WORKSPACES, state.workspaces.length > 0);
			}
			function save(patch: Partial<Persisted>): void {
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
				const kept = new Map(
					keep?.folders.map((folder) => [comparablePath(folder.path), folder.id]),
				);
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

			const originDatabase =
				typeof options.originDatabase === "function"
					? options.originDatabase(sdk)
					: options.originDatabase;
			if (originDatabase && !store.snapshot().importedFromOrigin) {
				void importOrigin(sdk, originDatabase, (imported) => {
					const existing = new Set(store.snapshot().workspaces.map((workspace) => workspace.id));
					const added = imported.filter((workspace) => !existing.has(workspace.id));
					save({
						workspaces: [...store.snapshot().workspaces, ...added],
						importedFromOrigin: true,
					});
					if (added.length > 0) void checkFolders();
				});
			}

			if (options.watch) provideWatcher(sdk, options.watch, () => store.snapshot().workspaces);
			followVcs(sdk);
		},
	});
}

/** Keeps the `vcs` key true while the `vcs` point's winner is implemented. */
function followVcs(sdk: PluginSdk): void {
	const publish = () =>
		sdk.context.set(VCS, sdk.extensions.exclusive(Vcs).winner?.implementation !== undefined);
	publish();
	sdk.extensions.subscribe(Vcs, publish);
}

async function importOrigin(
	sdk: PluginSdk,
	file: string,
	merge: (workspaces: Workspace[]) => void,
): Promise<void> {
	try {
		merge(await readOriginWorkspaces(file));
	} catch (error) {
		sdk.logger.warn(
			`Could not import workspaces from ${file}; will try again next launch: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

/**
 * The file watcher as a supervised daemon: one watch per workspace folder,
 * reconciled (serially, newest state wins) whenever the folder set changes;
 * batches go out as `kilo.workspaces/file` `changed` events.
 */
function provideWatcher(
	sdk: PluginSdk,
	watch: WatchOptions,
	listWorkspaces: () => readonly Workspace[],
): void {
	let watcher: WorkspaceWatcher | undefined;
	const files: DomainProvider<typeof Files> = sdk.domains.provide(Files, {
		initialState: { watched: [] },
		methods: {},
	});
	const publishStatus = () => {
		const directories = watcher?.status().directories ?? [];
		files.setState({
			watched: directories.map(({ path: folder, state }) => ({ path: folder, state })),
		});
	};
	const limit = pLimit(1);
	const reconcile = () =>
		limit(async () => {
			const folders = new Set(
				listWorkspaces().flatMap((workspace) => workspace.folders.map((folder) => folder.path)),
			);
			watcher?.reconcileDirectories(folders);
			publishStatus();
		});

	let stopFollowing: (() => void) | undefined;
	sdk.extensions.implement(KernelService, "watcher", {
		start: async () => {
			watcher = new WorkspaceWatcher({
				subscribeFn: watch.subscribeFn,
				realpath: watch.realpath,
				logger: sdk.logger,
				emit: (payload) => files.emit("changed", payload),
				onStatusChange: publishStatus,
				...(watch.retryDelayMs !== undefined ? { retryDelayMs: watch.retryDelayMs } : {}),
			});
			let lastFolders = "";
			stopFollowing = sdk.domains.get(Workspaces)?.subscribe((state) => {
				const folders = JSON.stringify(
					state.workspaces.flatMap((workspace) => workspace.folders.map((folder) => folder.path)),
				);
				if (folders === lastFolders) return;
				lastFolders = folders;
				void reconcile();
			});
			await reconcile();
		},
		stop: async () => {
			stopFollowing?.();
			const current = watcher;
			watcher = undefined;
			await current?.dispose();
			publishStatus();
		},
	});
}
