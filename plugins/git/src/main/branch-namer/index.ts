import {
	mainHost,
	type DomainHandle,
	type PluginSdk,
	type PluginStorage,
} from "@kilo-desktop/kernel";
import { Conversations } from "@kilo-desktop/plugin-agent/contracts";
import { isOrphanedWorktreeSession, WorkSessions } from "@kilo-desktop/plugin-sessions/contracts";
import type { VcsImplementation } from "@kilo-desktop/plugin-workspaces/contracts";

import { createBranchNamer, type ArmedChats, type NamerTarget } from "./controller.js";

export { createBranchNamer, MAX_PROMPTS } from "./controller.js";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The worktree branch namer in main (decision 55), driven by kilo.agent's
 * conversations and kilo.sessions' Work Sessions:
 *
 * - A chat is armed when it becomes the first chat of a session whose
 *   worktree kilo.sessions created (`worktreeCreated`) — never for an existing
 *   worktree picked at creation, nor for sessions from before this run unless
 *   their progress was saved.
 * - It stays eligible while its session's branch is `kilo/…` and it is the
 *   only Work Session and the only root chat in that directory.
 * - Messages sent to it (`user-message`) and its finished turns drive the
 *   controller; names come from `conversation.generateBranchName`, the rename
 *   from kilo.git's own `vcs` (which announces `worktree-branch-renamed` —
 *   the main window toasts it), then the session and the chat's stamp take
 *   the new branch.
 * - Progress per chat is kept in kv (`branch-namer`); a deleted session's
 *   chats are dropped.
 */
export function startBranchNamer(
	sdk: PluginSdk,
	vcs: Pick<VcsImplementation, "renameWorktreeBranch" | "hasWorktreeWork" | "isManagedBranch">,
): void {
	const storage = (mainHost(sdk) as { storage?: PluginStorage }).storage;
	const store = storage?.kv<{ armed: ArmedChats }>({
		namespace: "branch-namer",
		defaults: { armed: {} },
	});
	let sessions: DomainHandle<typeof WorkSessions> | undefined;
	let conversations: DomainHandle<typeof Conversations> | undefined;

	const target = (chatId: string): NamerTarget | null => {
		const list = sessions?.getState().sessions ?? [];
		const chats = conversations?.getState().chats ?? {};
		const session = list.find((candidate) => candidate.chatIds.includes(chatId));
		const branch = session?.worktreeBranch;
		const directory = session?.directory;
		if (!session?.worktreeCreated || !branch || !directory || !vcs.isManagedBranch(branch)) {
			return null;
		}
		if (!isOrphanedWorktreeSession(list, session.id)) return null;
		const soleRootChat = Object.values(chats).every(
			(chat) => chat.id === chatId || chat.parentId !== null || chat.directory !== directory,
		);
		return soleRootChat ? { sessionId: session.id, directory, currentBranch: branch } : null;
	};

	const namer = createBranchNamer({
		target,
		isBusy: (chatId) => {
			const status = conversations?.getState().chats[chatId]?.activity.status;
			return status === "busy" || status === "retry";
		},
		generate: async (input) => {
			if (!conversations) return null;
			const { branch } = await conversations.methods.generateBranchName(input);
			return branch;
		},
		rename: (input) => vcs.renameWorktreeBranch(input),
		hasWorktreeWork: (input) => vcs.hasWorktreeWork(input),
		renamed: async ({ chatId, sessionId, branch }) => {
			const results = await Promise.allSettled([
				sessions?.methods.setWorktreeBranch({ id: sessionId, branch }),
				conversations?.methods.setWorktreeBranch({ id: chatId, branch }),
			]);
			for (const result of results) {
				if (result.status === "rejected") {
					sdk.logger.warn(
						`Renamed the branch to ${branch} but could not record it: ${errorText(result.reason)}`,
					);
				}
			}
		},
		progress: {
			load: () => store?.snapshot().armed ?? {},
			save: (armed) => store?.set({ armed }),
		},
		log: (message) => sdk.logger.warn(message),
	});
	sdk.onDispose(() => namer.dispose());

	let stopSessions: (() => void) | undefined;
	let stopConversations: (() => void) | undefined;
	sdk.onDispose(() => {
		stopSessions?.();
		stopConversations?.();
	});
	sdk.onDispose(
		sdk.domains.track(WorkSessions, {
			added(handle) {
				sessions = handle;
				const stops = [
					handle.on("updated", ({ before, after }) => {
						const first = after.chatIds[0];
						if (before.chatIds.length === 0 && first && after.worktreeCreated) {
							namer.arm(first, { baseRef: after.baseRef });
						}
					}),
					handle.on("deleted", ({ session }) => session.chatIds.forEach(namer.forget)),
				];
				stopSessions = () => stops.forEach((stop) => stop());
			},
			removed() {
				stopSessions?.();
				sessions = undefined;
			},
		}),
	);

	sdk.onDispose(
		sdk.domains.track(Conversations, {
			added(handle) {
				conversations = handle;
				const stops = [
					handle.on("user-message", ({ chatId, text, model }) =>
						namer.prompt({ chatId, text, model }),
					),
					handle.on("turn-ended", ({ chatId }) => namer.turnEnded(chatId)),
				];
				stopConversations = () => stops.forEach((stop) => stop());
			},
			removed() {
				stopConversations?.();
				conversations = undefined;
			},
		}),
	);
}
