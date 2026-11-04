import { randomUUID } from "node:crypto";

import {
	definePlugin,
	KernelError,
	mainHost,
	type DomainHandle,
	type DomainProvider,
	type PluginEntry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { ChatOwner, Conversations, type ChatSummary } from "@kilo-desktop/plugin-agent/contracts";
import { Workspaces } from "@kilo-desktop/plugin-workspaces/contracts";

import {
	DEFAULT_SESSION_TITLE,
	isOrphanedWorktreeSession,
	Sessions,
	SESSIONS_PLUGIN_ID,
	type Session,
} from "../contracts";
import { readOriginSessions, type OriginSession } from "./import-origin";
import {
	discardPlacement,
	isolationOptions,
	linkAgentManager,
	linksFirstChat,
	placeSession,
	removeSessionWorktree,
	vcsOf,
	worktreeChatLinks,
} from "./isolation";
import { providePanes } from "./panes";

export interface SessionsMainOptions {
	readonly createId?: () => string;
	readonly createPaneId?: () => string;
	readonly now?: () => number;
	/** Origin's kilo-ui database, imported once. */
	readonly originDatabase?: string | ((sdk: PluginSdk) => string);
}

interface Persisted extends Record<string, unknown> {
	sessions: Session[];
	importedFromOrigin: boolean;
	legacyPinsImported: boolean;
	/** Chat ids origin pinned before they had a session; pinned on adoption. */
	pendingPinnedChatIds: string[];
	/** Whether origin's sessions a release imported as live were reopened to their chats' archives. */
	originArchivesReopened: boolean;
}

/**
 * The archive change time of a session no one has archived or restored, so
 * any archived chat archives it. Origin kept archives on its chats only, and
 * stamped sessions it adopted chats into with the adoption time, often after
 * the chat was archived; dating the choice to then would keep it live.
 */
const ARCHIVE_NEVER_CHOSEN = 0;

/**
 * A release imported origin's sessions with their creation time as their
 * archive change, so chats archived before origin adopted them came back
 * live. Each session still live with that stamp (the person hasn't archived
 * or restored it since) is reopened to its chats' archives, once. Sessions
 * this app created carry the same stamp, harmlessly: their chats' archives
 * are later than it, so already applied.
 */
function reopenOriginArchives(sessions: readonly Session[]): Session[] {
	return sessions.map((session) =>
		!session.archived && session.archiveChangedAt === session.createdAt
			? { ...session, archiveChangedAt: ARCHIVE_NEVER_CHOSEN }
			: session,
	);
}

/** What a person (or a chat, for a session adopted from it) set on a session, carried to the one replacing it. */
function personalChoices(session: Session): Partial<Session> {
	return {
		title: session.title,
		titleSource: session.titleSource,
		pinned: session.pinned,
		archived: session.archived,
		archiveChangedAt: session.archiveChangedAt,
		workspaceId: session.workspaceId,
		worktreeBranch: session.worktreeBranch,
		directory: session.directory,
		updatedAt: session.updatedAt,
	};
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * kilo.sessions in main. Work Sessions persist in the plugin's kv as one
 * value. Chats come from kilo.agent's `conversation` domain object: each time
 * it is ready every chat is applied, then its created / updated / deleted
 * events, in order and after origin's sessions are imported. This app's root
 * chats without a session join the session they were created for, or are
 * adopted into new ones; linked chats keep their session's title (until the
 * person renames it), directory and worktree current, and a chat archived
 * after the session's last archive change archives it; a deleted chat is
 * detached. Renames and deletes reach the chats too, best effort — the
 * session changes even when the server can't be reached. kilo.sessions
 * answers kilo.agent's `chat-owner` point: the session holding a chat.
 *
 * Origin's sessions are imported once; when the read fails it is retried next
 * launch, and origin's pins and panes (handed over by the main window every
 * launch) wait for it, so they are only marked imported alongside the
 * sessions they name. Chats adopted meanwhile fold back into origin's session.
 * Origin kept archives on its chats, so its sessions take their archived state
 * from their chats (`ARCHIVE_NEVER_CHOSEN`). Workspaces are taken from chats only while kilo.workspaces knows them.
 *
 * Isolation (decision 54) is chosen at creation: `kilo.workspaces/vcs`
 * creates or resolves the session's worktree in its workspace's primary
 * folder before the session exists, and a session placed this way keeps its
 * directory and branch whatever its chats report. Its first chat is linked
 * for the VS Code Agent Manager; worktree chats from before that are linked
 * once per run on the first full read. Deleting with `removeWorktree`
 * removes a worktree no other session shares, after kilo.agent releases the
 * directory's Kilo instance.
 */
export function createSessionsMainEntry(options: SessionsMainOptions): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const createId = options.createId ?? (() => `wses_${randomUUID()}`);
			const now = options.now ?? Date.now;
			const store = mainHost(sdk).storage.kv<Persisted>({
				namespace: "sessions",
				defaults: {
					sessions: [],
					importedFromOrigin: false,
					legacyPinsImported: false,
					pendingPinnedChatIds: [],
					originArchivesReopened: false,
				},
			});
			if (!store.snapshot().originArchivesReopened) {
				const { sessions: saved, importedFromOrigin } = store.snapshot();
				try {
					store.set({
						...(importedFromOrigin ? { sessions: reopenOriginArchives(saved) } : {}),
						originArchivesReopened: true,
					});
				} catch (error) {
					sdk.logger.warn(
						`Could not reopen origin's archived sessions; will try again next launch: ${errorText(error)}`,
					);
				}
			}
			let conversations: DomainHandle<typeof Conversations> | undefined;

			const sessions: DomainProvider<typeof Sessions> = sdk.domains.provide(Sessions, {
				initialState: { sessions: store.snapshot().sessions },
				methods: {
					create: async ({ workspaceId, title, isolation }) => {
						const placement = await placeSession(sdk, workspaceId ?? null, isolation);
						const timestamp = now();
						const trimmed = title?.trim();
						const session: Session = {
							id: createId(),
							title: trimmed || DEFAULT_SESSION_TITLE,
							titleSource: trimmed ? "user" : "default",
							pinned: false,
							archived: false,
							archiveChangedAt: timestamp,
							workspaceId: workspaceId ?? null,
							worktreeBranch: placement?.branch ?? null,
							directory: placement?.directory ?? null,
							chatIds: [],
							createdAt: timestamp,
							updatedAt: timestamp,
							...(placement ? { isolation: placement.isolation } : {}),
							...(placement?.baseRef ? { baseRef: placement.baseRef } : {}),
							...(placement?.created ? { worktreeCreated: true } : {}),
						};
						try {
							save([...list(), session]);
						} catch (error) {
							if (placement) await discardPlacement(sdk, placement);
							throw new KernelError("INTERNAL", `Could not save the session: ${errorText(error)}`);
						}
						sessions.emit("created", { session });
						return session;
					},
					rename: ({ id, title }) => {
						const after = change(id, { title, titleSource: "user", updatedAt: now() });
						const first = after.chatIds[0];
						if (first) {
							void chatWrite("rename chat", (chats) => chats.methods.rename({ id: first, title }));
						}
						return after;
					},
					setPinned: ({ id, pinned }) => change(id, { pinned }),
					setArchived: ({ id, archived }) =>
						change(id, { archived, archiveChangedAt: now(), updatedAt: now() }),
					setWorktreeBranch: ({ id, branch }) => {
						if (find(id)?.worktreeBranch === null) {
							throw new KernelError("VALIDATION", "The session doesn't run in a worktree.");
						}
						return change(id, { worktreeBranch: branch, updatedAt: now() });
					},
					remove: async ({ id, removeWorktree }) => {
						const session = find(id);
						if (!session) return { deleted: false };
						const orphaned = isOrphanedWorktreeSession(list(), id);
						save(list().filter((candidate) => candidate.id !== id));
						sessions.emit("deleted", { session });
						const deletes = session.chatIds.map((chatId) =>
							chatWrite("delete chat", (chats) => chats.methods.delete({ id: chatId })),
						);
						if (!removeWorktree || !orphaned || !session.directory) return { deleted: true };
						await Promise.all(deletes);
						try {
							await removeSessionWorktree(sdk, session.directory);
							return { deleted: true, worktreeRemoved: true };
						} catch (error) {
							return { deleted: true, worktreeRemoved: false, worktreeError: errorText(error) };
						}
					},
					isolationOptions: ({ workspaceId }) => isolationOptions(sdk, workspaceId),
					importLegacyPins: async ({ ids }, caller) => {
						if (caller.pluginId !== SESSIONS_PLUGIN_ID) {
							throw new KernelError("PERMISSION_DENIED", "Only kilo.sessions hands over its pins.");
						}
						// Origin's pins name its sessions: wait for them, and leave the pins
						// to next launch's hand-over when origin's sessions couldn't be read.
						if (!(await originImport)) return;
						if (store.snapshot().legacyPinsImported) return;
						importPins(ids);
					},
				},
			});

			providePanes(sdk, {
				...(options.createPaneId ? { createId: options.createPaneId } : {}),
				// Referenced lazily: hand-overs arrive after activation, once the import has started.
				originSessionsImported: () => originImport,
			});

			function list(): Session[] {
				return store.snapshot().sessions;
			}
			function find(id: string): Session | undefined {
				return list().find((session) => session.id === id);
			}
			function save(next: Session[], patch: Partial<Persisted> = {}): void {
				store.set({ ...patch, sessions: next });
				sessions.setState({ sessions: next });
			}
			function change(id: string, patch: Partial<Session>): Session {
				const before = find(id);
				if (!before) throw new KernelError("NOT_FOUND", "Session not found.");
				const after = { ...before, ...patch };
				save(list().map((session) => (session.id === id ? after : session)));
				sessions.emit("updated", { before, after });
				return after;
			}
			async function chatWrite(
				label: string,
				write: (chats: DomainHandle<typeof Conversations>) => Promise<void>,
			) {
				if (!conversations) return;
				try {
					await write(conversations);
				} catch (error) {
					sdk.logger.warn(`Could not ${label} on the Kilo server: ${errorText(error)}`);
				}
			}

			function importPins(ids: readonly string[]): void {
				const wanted = new Set(ids);
				const pinnedChats = new Set<string>();
				const next = list().map((session) => {
					const pinned =
						wanted.has(session.id) || session.chatIds.some((chatId) => wanted.has(chatId));
					return pinned && !session.pinned ? { ...session, pinned: true } : session;
				});
				const linked = new Set(next.flatMap((session) => session.chatIds));
				for (const id of ids) if (id.startsWith("ses_") && !linked.has(id)) pinnedChats.add(id);
				save(next, { legacyPinsImported: true, pendingPinnedChatIds: [...pinnedChats] });
			}

			/** Applies one chat as kilo.agent reports it; see the rules above. */
			function applyChat(chat: ChatSummary): void {
				if (chat.parentId) return;
				let owner = list().find((session) => session.chatIds.includes(chat.id));
				const archivedAt = chat.archivedAt;
				if (!owner) {
					const target = chat.workSessionId ? find(chat.workSessionId) : undefined;
					if (target) {
						if (linksFirstChat(target)) {
							void linkAgentManager(sdk, {
								directory: target.directory!,
								sessionId: chat.id,
								baseRef: target.baseRef,
							});
						}
						owner = change(target.id, { chatIds: [...target.chatIds, chat.id] });
					}
				}
				const workspaceId = knownWorkspace(chat.workspaceId);
				if (!owner) {
					const pending = store.snapshot().pendingPinnedChatIds;
					const session: Session = {
						id: createId(),
						title: chat.title || DEFAULT_SESSION_TITLE,
						titleSource: chat.title ? "chat" : "default",
						pinned: pending.includes(chat.id),
						archived: archivedAt !== undefined,
						archiveChangedAt: archivedAt ?? chat.createdAt,
						workspaceId,
						worktreeBranch: chat.worktreeBranch,
						directory: chat.directory,
						chatIds: [chat.id],
						createdAt: chat.createdAt,
						updatedAt: chat.updatedAt,
					};
					save([...list(), session], {
						pendingPinnedChatIds: pending.filter((chatId) => chatId !== chat.id),
					});
					sessions.emit("created", { session });
					return;
				}
				const patch: Partial<Session> = {};
				const leadsTitle = owner.chatIds[0] === chat.id;
				if (
					leadsTitle &&
					owner.titleSource !== "user" &&
					chat.title &&
					chat.title !== owner.title
				) {
					patch.title = chat.title;
					patch.titleSource = "chat";
				}
				if (owner.isolation === undefined) {
					if (chat.directory && chat.directory !== owner.directory)
						patch.directory = chat.directory;
					if (chat.worktreeBranch !== owner.worktreeBranch)
						patch.worktreeBranch = chat.worktreeBranch;
				}
				if (owner.workspaceId === null && workspaceId) patch.workspaceId = workspaceId;
				if (archivedAt !== undefined && !owner.archived && archivedAt > owner.archiveChangedAt) {
					patch.archived = true;
					patch.archiveChangedAt = archivedAt;
				}
				if (chat.updatedAt > owner.updatedAt) patch.updatedAt = chat.updatedAt;
				if (Object.keys(patch).length > 0) change(owner.id, patch);
			}

			// Worktrees from before chats were linked at creation get their link
			// once per run, on the first full read; vcs never overwrites a link.
			let linksBackfilled = false;
			function backfillAgentManagerLinks(chats: readonly ChatSummary[]): void {
				if (linksBackfilled || !vcsOf(sdk)) return;
				linksBackfilled = true;
				void (async () => {
					let linked = 0;
					for (const link of worktreeChatLinks(chats)) {
						const wrote = await linkAgentManager(sdk, {
							directory: link.directory,
							sessionId: link.chatId,
						});
						if (wrote) linked += 1;
					}
					if (linked > 0) {
						sdk.logger.info(`Linked ${linked} worktree chat(s) for the VS Code Agent Manager.`);
					}
				})();
			}

			/**
			 * A chat keeps the workspace it was stamped with after that workspace is
			 * deleted (origin cleared stamps from a queue this app doesn't import), so
			 * only workspaces kilo.workspaces knows are taken from chats. Without
			 * kilo.workspaces there is nothing to check against and the stamp is kept.
			 */
			function knownWorkspace(workspaceId: string | null): string | null {
				const workspaces = sdk.domains.get(Workspaces);
				if (!workspaceId || !workspaces) return workspaceId;
				return workspaces.getState().workspaces.some((workspace) => workspace.id === workspaceId)
					? workspaceId
					: null;
			}

			function detachChat(chatId: string): void {
				const owner = list().find((session) => session.chatIds.includes(chatId));
				if (owner) {
					change(owner.id, { chatIds: owner.chatIds.filter((id) => id !== chatId) });
				}
			}

			const originDatabase =
				typeof options.originDatabase === "function"
					? options.originDatabase(sdk)
					: options.originDatabase;
			/** Settles true once origin's sessions are imported (or there are none), false to retry next launch. */
			const originImport: Promise<boolean> =
				originDatabase && !store.snapshot().importedFromOrigin
					? importOrigin(originDatabase)
					: Promise.resolve(true);
			async function importOrigin(file: string): Promise<boolean> {
				try {
					mergeOriginSessions(await readOriginSessions(file));
					return true;
				} catch (error) {
					sdk.logger.warn(
						`Could not import sessions from ${file}; will try again next launch: ${errorText(error)}`,
					);
					return false;
				}
			}

			/**
			 * Adds origin's sessions with their chats. A launch whose import failed
			 * adopted origin's chats into sessions of their own; such a session
			 * (every chat it holds belongs to one origin session) is folded into
			 * origin's, keeping what the person changed on it. A chat held by any
			 * other session stays there and leaves origin's session.
			 */
			function mergeOriginSessions(origin: readonly OriginSession[]): void {
				const current = list();
				const existing = new Set(current.map((session) => session.id));
				const fresh = origin.filter((session) => !existing.has(session.id));
				const originOf = new Map<string, string>();
				for (const session of fresh) {
					for (const chatId of session.chatIds) originOf.set(chatId, session.id);
				}
				const adopted = current.filter((session) => {
					const target = session.chatIds[0] && originOf.get(session.chatIds[0]);
					return target && session.chatIds.every((chatId) => originOf.get(chatId) === target);
				});
				const kept = current.filter((session) => !adopted.includes(session));
				const held = new Set(kept.flatMap((session) => session.chatIds));
				const added = fresh.flatMap((session): Session[] => {
					const chatIds = session.chatIds.filter((chatId) => !held.has(chatId));
					if (session.chatIds.length > 0 && chatIds.length === 0) return [];
					const folded = adopted.filter((candidate) => chatIds.includes(candidate.chatIds[0]!));
					// The session holding origin's first chat leads, as that chat leads the title.
					const lead = folded.find((candidate) => candidate.chatIds.includes(chatIds[0]!));
					return [
						{
							id: session.id,
							title: DEFAULT_SESSION_TITLE,
							titleSource: "default",
							pinned: false,
							archived: false,
							archiveChangedAt: ARCHIVE_NEVER_CHOSEN,
							workspaceId: null,
							worktreeBranch: null,
							directory: null,
							createdAt: session.createdAt,
							updatedAt: session.createdAt,
							...(lead ? personalChoices(lead) : {}),
							...(folded.some((candidate) => candidate.pinned) ? { pinned: true } : {}),
							chatIds,
						},
					];
				});
				save([...kept, ...added], { importedFromOrigin: true });
				for (const session of adopted) sessions.emit("deleted", { session });
			}

			// Chats apply in order, after origin's sessions are imported.
			let chatQueue: Promise<unknown> = originImport;
			const inOrder = (task: () => void) => {
				chatQueue = chatQueue
					.then(task)
					.catch((error) => sdk.logger.warn(`Could not apply a Kilo chat: ${errorText(error)}`));
			};
			let stopConversations: (() => void) | undefined;
			sdk.domains.track(Conversations, {
				added(handle) {
					conversations = handle;
					let wasReady = false;
					const follow = ({ ready }: { ready: boolean }) => {
						if (ready && !wasReady) {
							inOrder(() => {
								const chats = Object.values(handle.getState().chats);
								for (const chat of chats) applyChat(chat);
								backfillAgentManagerLinks(chats);
							});
						}
						wasReady = ready;
					};
					follow(handle.getState());
					const stops = [
						handle.subscribe(follow),
						handle.on("created", ({ chat }) => inOrder(() => applyChat(chat))),
						handle.on("updated", ({ after }) => inOrder(() => applyChat(after))),
						handle.on("deleted", ({ chat }) => inOrder(() => detachChat(chat.id))),
					];
					stopConversations = () => stops.forEach((stop) => stop());
				},
				removed() {
					stopConversations?.();
					conversations = undefined;
				},
			});

			sdk.extensions.implement(ChatOwner, "sessions", {
				sessionOf: (chatId) =>
					list().find((session) => session.chatIds.includes(chatId))?.id ?? null,
			});

			let stopWorkspaces: (() => void) | undefined;
			sdk.domains.track(Workspaces, {
				added(workspaces) {
					stopWorkspaces = workspaces.on("deleted", ({ before }) => {
						if (!before) return;
						for (const session of list()) {
							if (session.workspaceId === before.id) change(session.id, { workspaceId: null });
						}
					});
				},
				removed() {
					stopWorkspaces?.();
				},
			});

			sdk.onDispose(() => {
				stopConversations?.();
				stopWorkspaces?.();
			});
		},
	});
}
