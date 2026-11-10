import type { DomainObjectHandle, PluginSdk } from "@kilo-desktop/kernel";
import { Chats, type ChatSummary } from "@kilo-desktop/plugin-core/contracts";

import { DEFAULT_WORK_SESSION_TITLE, Workspaces, type WorkSession } from "../../contracts/model";
import { copyChatLinks, linkAgentManager, linksFirstChat, vcsOf } from "./isolation";
import type { WorkSessionRegistry } from "./registry";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export interface ChatFollower {
	/** kilo.core's chats while present. */
	current(): DomainObjectHandle<typeof Chats> | undefined;
	/** Applies a chat (e.g. one just created) in order with the ones kilo.core announces. */
	apply(chat: ChatSummary): void;
	/** Writes to the Kilo server, best effort: logged, never thrown. */
	write(
		label: string,
		task: (chats: DomainObjectHandle<typeof Chats>) => Promise<void>,
	): Promise<void>;
}

/**
 * Derives each work session's chats from `kilo.core/chats`: each time the
 * list is ready every chat is applied, then its created / updated / deleted
 * events, in order and after origin's work sessions are imported (`after`).
 * A root chat joins the work session its stamp names (`workSessionId`); a
 * stamp naming a work session this app doesn't know — or no stamp at all —
 * makes a work session from the chat, under the stamped id when there is one
 * so that chat's later siblings join it too. Linked chats keep their work
 * session's title (until the person renames it), directory and branch
 * current (a work session placed at creation keeps its own), and a chat
 * archived after the work session's last archive change archives it; a
 * deleted chat is detached. Without kilo.core there are no chats and nothing
 * changes.
 */
export function followChats(
	sdk: PluginSdk,
	registry: WorkSessionRegistry,
	options: { readonly createId: () => string; readonly after: Promise<unknown> },
): ChatFollower {
	let chats: DomainObjectHandle<typeof Chats> | undefined;

	let queue: Promise<unknown> = options.after;
	const inOrder = (task: () => void) => {
		queue = queue
			.then(task)
			.catch((error) => sdk.logger.warn(`Could not apply a Kilo chat: ${errorText(error)}`));
	};

	/**
	 * A chat keeps the workspace it was stamped with after that workspace is
	 * deleted, so only workspaces this plugin knows are taken from chats.
	 */
	function knownWorkspace(workspaceId: string | null): string | null {
		if (!workspaceId) return null;
		const workspaces = sdk.domainObjects.get(Workspaces)?.getState().workspaces ?? [];
		return workspaces.some((workspace) => workspace.id === workspaceId) ? workspaceId : null;
	}

	function adopt(chat: ChatSummary, workspaceId: string | null): void {
		const archivedAt = chat.archivedAt;
		registry.add({
			id: chat.workSessionId ?? options.createId(),
			title: chat.title || DEFAULT_WORK_SESSION_TITLE,
			titleSource: chat.title ? "chat" : "default",
			pinned: false,
			archived: archivedAt !== undefined,
			archiveChangedAt: archivedAt ?? chat.createdAt,
			workspaceId,
			branch: chat.worktreeBranch,
			directory: chat.directory,
			chatIds: [chat.id],
			createdAt: chat.createdAt,
			updatedAt: chat.updatedAt,
		});
	}

	function join(target: WorkSession, chat: ChatSummary): WorkSession {
		if (linksFirstChat(target)) {
			void linkAgentManager(sdk, {
				directory: target.directory!,
				chatId: chat.id,
				baseRef: target.baseRef,
			});
		}
		return registry.change(target.id, { chatIds: [...target.chatIds, chat.id] });
	}

	function follow(owner: WorkSession, chat: ChatSummary, workspaceId: string | null): void {
		const patch: Partial<WorkSession> = {};
		const leadsTitle = owner.chatIds[0] === chat.id;
		if (leadsTitle && owner.titleSource !== "user" && chat.title && chat.title !== owner.title) {
			patch.title = chat.title;
			patch.titleSource = "chat";
		}
		if (owner.isolation === undefined) {
			if (chat.directory && chat.directory !== owner.directory) patch.directory = chat.directory;
			if (chat.worktreeBranch !== owner.branch) patch.branch = chat.worktreeBranch;
		}
		if (owner.workspaceId === null && workspaceId) patch.workspaceId = workspaceId;
		const archivedAt = chat.archivedAt;
		if (archivedAt !== undefined && !owner.archived && archivedAt > owner.archiveChangedAt) {
			patch.archived = true;
			patch.archiveChangedAt = archivedAt;
		}
		if (chat.updatedAt > owner.updatedAt) patch.updatedAt = chat.updatedAt;
		if (Object.keys(patch).length > 0) registry.change(owner.id, patch);
	}

	function applyChat(chat: ChatSummary): void {
		if (chat.parentId) return;
		const workspaceId = knownWorkspace(chat.workspaceId);
		let owner = registry.holding(chat.id);
		if (!owner) {
			const target = chat.workSessionId ? registry.find(chat.workSessionId) : undefined;
			if (!target) return adopt(chat, workspaceId);
			owner = join(target, chat);
		}
		follow(owner, chat, workspaceId);
	}

	function detachChat(chatId: string): void {
		const owner = registry.holding(chatId);
		if (owner) registry.change(owner.id, { chatIds: owner.chatIds.filter((id) => id !== chatId) });
	}

	// Copies from before chats were linked at creation get their link once per
	// run, on the first full read; vcs never overwrites a link.
	let linksBackfilled = false;
	function backfillAgentManagerLinks(all: readonly ChatSummary[]): void {
		if (linksBackfilled || !vcsOf(sdk)) return;
		linksBackfilled = true;
		void (async () => {
			let linked = 0;
			for (const link of copyChatLinks(all)) {
				if (await linkAgentManager(sdk, link)) linked += 1;
			}
			if (linked > 0) {
				sdk.logger.info(`Linked ${linked} copy chat(s) for the VS Code Agent Manager.`);
			}
		})();
	}

	let stop: (() => void) | undefined;
	sdk.domainObjects.track(Chats, {
		added(handle) {
			chats = handle;
			let wasReady = false;
			const onState = ({ ready }: { ready: boolean }) => {
				if (ready && !wasReady) {
					inOrder(() => {
						const all = Object.values(handle.getState().chats);
						for (const chat of all) applyChat(chat);
						backfillAgentManagerLinks(all);
					});
				}
				wasReady = ready;
			};
			onState(handle.getState());
			const stops = [
				handle.subscribe(onState),
				handle.on("created", ({ chat }) => inOrder(() => applyChat(chat))),
				handle.on("updated", ({ after }) => inOrder(() => applyChat(after))),
				handle.on("deleted", ({ chat }) => inOrder(() => detachChat(chat.id))),
			];
			stop = () => stops.forEach((dispose) => dispose());
		},
		removed() {
			stop?.();
			stop = undefined;
			chats = undefined;
		},
	});
	sdk.onDispose(() => stop?.());

	return {
		current: () => chats,
		apply: (chat) => inOrder(() => applyChat(chat)),
		async write(label, task) {
			if (!chats) return;
			try {
				await task(chats);
			} catch (error) {
				sdk.logger.warn(`Could not ${label} on the Kilo server: ${errorText(error)}`);
			}
		},
	};
}
