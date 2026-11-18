import { randomUUID } from "node:crypto";

import { KernelError, type PluginSdk } from "@kilo-desktop/kernel";

import {
	defaultWorkSessionTitle,
	isOrphanedCopySession,
	workSessionFolders,
	WorkSessions,
	Workspaces,
	type WorkSession,
} from "../../contracts/model";
import type { SqliteLoader } from "../origin-database";
import { workSessionsStore } from "../storage/stores";
import { followChats } from "./chats";
import {
	discardPlacement,
	followVcs,
	isolationOptions,
	placeWorkSession,
	removeWorkSessionCopy,
} from "./isolation";
import { importOriginWorkSessions, reopenOriginArchives } from "./origin";
import { WorkSessionRegistry } from "./registry";

export interface WorkSessionsOptions {
	readonly createId?: () => string;
	readonly now?: () => number;
	/** Origin's kilo-ui database, imported once. */
	readonly originDatabase?: string;
	/** Loads better-sqlite3 for that import. */
	readonly loadSqlite?: SqliteLoader;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Work sessions in main, persisted as one kv value (`WorkSessionRegistry`).
 * Their chats come from kilo.core's chat stamps (`followChats`); renames,
 * branch renames and deletes reach the chats too, best effort — the work
 * session changes even when the server can't be reached. Origin's work
 * sessions are imported once before any chat is applied, so chats adopted
 * meanwhile fold back into origin's.
 *
 * Isolation is chosen at creation: the `vcs` contribution creates or
 * resolves the work session's copy in its workspace's primary folder before
 * the work session exists, and a work session placed this way keeps its
 * directory and branch whatever its chats report. Its first chat is linked
 * for the VS Code Agent Manager. Deleting with `removeCopy` removes a copy no
 * other work session shares, after kilo.core releases the directory's Kilo
 * instance. `hasVcs` follows the `vcs` point.
 */
export function activateWorkSessions(sdk: PluginSdk, options: WorkSessionsOptions = {}): void {
	const createId = options.createId ?? (() => `wses_${randomUUID()}`);
	const now = options.now ?? Date.now;
	const store = workSessionsStore(sdk);

	const provider = sdk.domainObjects.provide(WorkSessions, {
		initialState: { workSessions: store.snapshot().workSessions },
		methods: {
			create: async ({ workspaceId, title, isolation }) => {
				const placement = await placeWorkSession(sdk, workspaceId ?? null, isolation);
				const timestamp = now();
				const trimmed = title?.trim();
				const workSession: WorkSession = {
					id: createId(),
					title: trimmed || defaultWorkSessionTitle(timestamp),
					titleSource: trimmed ? "user" : "default",
					pinned: false,
					archived: false,
					archiveChangedAt: timestamp,
					workspaceId: workspaceId ?? null,
					branch: placement?.branch ?? null,
					directory: placement?.directory ?? null,
					chatIds: [],
					createdAt: timestamp,
					updatedAt: timestamp,
					...(placement ? { isolation: placement.isolation } : {}),
					...(placement?.baseRef ? { baseRef: placement.baseRef } : {}),
					...(placement?.created ? { copyCreated: true } : {}),
				};
				try {
					registry.add(workSession);
				} catch (error) {
					if (placement) await discardPlacement(sdk, placement);
					throw new KernelError("INTERNAL", `Could not save the session: ${errorText(error)}`);
				}
				return workSession;
			},
			createChat: async ({ id, agent, model, title }) => {
				const workSession = requireWorkSession(id);
				const handle = chats.current();
				if (!handle) {
					throw new KernelError("UNAVAILABLE", "Chats are unavailable — Kilo is not running.");
				}
				const folders = workspaceFolders(workSession.workspaceId);
				const primary = folders.find((folder) => folder.isPrimary)?.path;
				const directory = workSession.directory ?? primary;
				const chat = await handle.methods.create({
					workSessionId: workSession.id,
					...(directory ? { directory } : {}),
					...(workSession.workspaceId ? { workspaceId: workSession.workspaceId } : {}),
					...(folders.length > 0
						? { workspaceFolders: workSessionFolders(folders, workSession.directory) }
						: {}),
					...(workSession.branch ? { worktreeBranch: workSession.branch } : {}),
					...(agent ? { agent } : {}),
					...(model ? { model } : {}),
					...(title ? { title } : {}),
				});
				chats.apply(chat);
				return chat;
			},
			forkChat: async ({ id, chatId, messageId }) => {
				const workSession = requireWorkSession(id);
				if (!workSession.chatIds.includes(chatId)) {
					throw new KernelError("NOT_FOUND", "The chat isn't in this session.");
				}
				const handle = chats.current();
				if (!handle) {
					throw new KernelError("UNAVAILABLE", "Chats are unavailable — Kilo is not running.");
				}
				const chat = await handle.methods.fork({ id: chatId, messageId });
				chats.apply(chat);
				return chat;
			},
			rename: ({ id, title }) => {
				const after = registry.change(id, { title, titleSource: "user", updatedAt: now() });
				const first = after.chatIds[0];
				if (first) {
					void chats.write("rename chat", (handle) => handle.methods.rename({ id: first, title }));
				}
				return after;
			},
			setPinned: ({ id, pinned }) => registry.change(id, { pinned }),
			setArchived: ({ id, archived }) =>
				registry.change(id, { archived, archiveChangedAt: now(), updatedAt: now() }),
			setBranch: ({ id, branch }) => {
				if (requireWorkSession(id).branch === null) {
					throw new KernelError("VALIDATION", "The session doesn't run in a copy.");
				}
				const after = registry.change(id, { branch, updatedAt: now() });
				for (const chatId of after.chatIds) {
					void chats.write("rename the chat's branch", (handle) =>
						handle.methods.setWorktreeBranch({ id: chatId, branch }),
					);
				}
				return after;
			},
			remove: async ({ id, removeCopy }) => {
				const workSession = registry.find(id);
				if (!workSession) return { deleted: false };
				const orphaned = isOrphanedCopySession(registry.list(), id);
				chats.forget(workSession);
				registry.delete(workSession);
				const deletes = workSession.chatIds.map((chatId) =>
					chats.write("delete chat", (handle) => handle.methods.delete({ id: chatId })),
				);
				if (!removeCopy || !orphaned || !workSession.directory) return { deleted: true };
				await Promise.all(deletes);
				try {
					await removeWorkSessionCopy(sdk, workSession.directory);
					return { deleted: true, copyRemoved: true };
				} catch (error) {
					return { deleted: true, copyRemoved: false, copyError: errorText(error) };
				}
			},
			isolationOptions: ({ workspaceId }) => isolationOptions(sdk, workspaceId),
		},
	});
	const registry = new WorkSessionRegistry(store, provider);

	function requireWorkSession(id: string): WorkSession {
		const workSession = registry.find(id);
		if (!workSession) throw new KernelError("NOT_FOUND", "Session not found.");
		return workSession;
	}
	function workspaceFolders(workspaceId: string | null) {
		if (!workspaceId) return [];
		const workspace = sdk.domainObjects
			.get(Workspaces)
			?.getState()
			.workspaces.find((candidate) => candidate.id === workspaceId);
		return (workspace?.folders ?? []).map(({ path, isPrimary }) => ({ path, isPrimary }));
	}

	reopenOriginArchives(sdk, registry);
	const originImport = importOriginWorkSessions(
		sdk,
		registry,
		options.originDatabase,
		options.loadSqlite,
	);
	const chats = followChats(sdk, registry, { createId, after: originImport });

	const workspaces = sdk.domainObjects.get(Workspaces);
	const stopWorkspaces = workspaces?.on("deleted", ({ before }) => {
		if (!before) return;
		for (const workSession of registry.list()) {
			if (workSession.workspaceId === before.id) {
				registry.change(workSession.id, { workspaceId: null });
			}
		}
	});
	sdk.onDispose(() => stopWorkspaces?.());

	followVcs(sdk);
}
