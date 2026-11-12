import {
	KernelWindows,
	type AnyDomainObject,
	type DomainObjectHandle,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { Chats, type ChatSummary } from "@kilo-desktop/plugin-core/contracts";
import {
	Panes,
	shownPaneIds,
	WorkSessions,
	type Pane,
	type PaneStatus,
	type WorkSession,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	AGENT_PANE_KIND,
	paneChatId,
	chatPaneObject,
	SUBAGENT_PANE_KIND,
	subagentPaneChildChatId,
} from "../../contracts";

type ChatsState = ReturnType<DomainObjectHandle<typeof Chats>["getState"]>;

/** The agent pane a chat-adopted work session is given (origin's and kilo.sessions' id). */
export const adoptedAgentPaneId = (workSessionId: string): string => `agent:${workSessionId}`;

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Whether a chat or one of its descendants waits on the person. */
function waitsOnPerson(chats: ChatsState["chats"], chatId: string): boolean {
	const asking = (chat: ChatSummary) =>
		chat.activity.pendingPermissionIds.length > 0 || chat.activity.pendingQuestionIds.length > 0;
	const root = chats[chatId];
	if (root && asking(root)) return true;
	const descendants = new Set([chatId]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const chat of Object.values(chats)) {
			if (!chat.parentId || descendants.has(chat.id) || !descendants.has(chat.parentId)) continue;
			if (asking(chat)) return true;
			descendants.add(chat.id);
			grew = true;
		}
	}
	return false;
}

/** The tab badge for a chat: waiting on the person, working, or nothing. */
export function chatPaneStatus(chats: ChatsState | null, chatId: string | null): PaneStatus | null {
	if (!chats?.ready || !chatId) return null;
	const chat = chats.chats[chatId];
	if (!chat) return null;
	if (waitsOnPerson(chats.chats, chatId)) return "attention";
	return chat.activity.status === "idle" ? null : "busy";
}

/**
 * The tab's status with unread: a chat that stops working (`busy` → idle)
 * while its tab is off screen stays `unread` until the tab is shown. Unread is
 * kept while kilo.core's chats aren't read, so a restart doesn't lose it.
 */
export function withUnread(
	live: PaneStatus | null,
	previous: PaneStatus | null,
	onScreen: boolean,
	chatsRead: boolean,
): PaneStatus | null {
	if (live || onScreen) return live;
	if (previous === "unread") return "unread";
	return chatsRead && previous === "busy" ? "unread" : null;
}

/** An agent pane's tab title: its chat's, "New chat" for a draft, null to leave it as it is. */
export function agentPaneTitle(chats: ChatsState | null, chatId: string | null): string | null {
	if (!chats?.ready) return null;
	if (!chatId) return "New chat";
	const chat = chats.chats[chatId];
	if (!chat) return null;
	return chat.title || "New chat";
}

/**
 * kilo.chat's panes in main, for every window:
 *
 * - **Agent panes for chat-adopted work sessions.** A work session that holds
 *   chats but has no panes record at all (kilo.work-sessions made it from a
 *   chat: one created on the Kilo CLI, by an external app, imported from
 *   origin) gets an agent pane showing its first chat, at activation and when
 *   such a work session is `created`. A person's new work session starts with
 *   no chat, and one whose panes were all closed keeps its empty record, so
 *   neither gets a pane it didn't ask for. This was kilo.sessions' job before
 *   the agent pane kind moved to kilo.chat.
 * - **Pane status.** Each agent pane's chat (`paneChatId`) and each
 *   subagent pane's child chat set the pane's `status` from kilo.core's
 *   chats: `attention` while it (or a subagent of it) waits on a permission
 *   or question, `busy` while it works, cleared otherwise — also when
 *   kilo.core is absent or the chat isn't listed, so a badge saved with the
 *   panes never outlives the turn it reported. A chat that finishes while
 *   its tab is off screen (not the tab its group shows, nor popped out) is
 *   `unread` until the tab is shown.
 * - **Agent pane titles.** Each agent pane's tab is named after its chat, so
 *   tabs and the Agents menu agree; a draft is "New chat". Titles are
 *   left alone until kilo.core's chats are read.
 *
 * Changes are written only when they differ, and a write in flight is not repeated.
 */
export function activateChatPanes(sdk: PluginSdk): void {
	const writing = new Map<string, string>();

	const handles = () => ({
		panes: sdk.domainObjects.get(Panes),
		workSessions: sdk.domainObjects.get(WorkSessions),
		chats: sdk.domainObjects.get(Chats),
	});

	function openAdoptedPanes(candidates: readonly WorkSession[]): void {
		const { panes } = handles();
		if (!panes) return;
		const records = panes.getState().byWorkSession;
		for (const workSession of candidates) {
			const firstChatId = workSession.chatIds[0];
			if (!firstChatId || records[workSession.id]) continue;
			panes.methods
				.open({
					workSessionId: workSession.id,
					paneId: adoptedAgentPaneId(workSession.id),
					kind: AGENT_PANE_KIND,
					title: workSession.title,
					object: chatPaneObject(firstChatId),
				})
				.catch((error: unknown) =>
					sdk.logger.warn(
						`Could not open the agent pane of work session ${workSession.id}: ${errorText(error)}`,
					),
				);
		}
	}

	function paneChat(pane: Pane) {
		if (pane.kind === AGENT_PANE_KIND) return paneChatId(pane);
		if (pane.kind === SUBAGENT_PANE_KIND) return subagentPaneChildChatId(pane);
		return undefined;
	}

	function syncPanes(): void {
		const { panes, chats } = handles();
		if (!panes) return;
		const chatsState = chats?.getState() ?? null;
		const windows = sdk.domainObjects.get(KernelWindows)?.getState() ?? null;
		const chatsRead = chatsState?.ready === true;
		for (const [workSessionId, record] of Object.entries(panes.getState().byWorkSession)) {
			const shown = shownPaneIds(workSessionId, record, windows);
			for (const pane of record.panes) {
				const chatId = paneChat(pane);
				if (chatId === undefined) continue;
				const listed = chatsRead && chatId !== null && chatId in chatsState.chats;
				const status = withUnread(
					chatPaneStatus(chatsState, chatId),
					pane.status ?? null,
					shown.has(pane.id),
					listed,
				);
				const title = pane.kind === AGENT_PANE_KIND ? agentPaneTitle(chatsState, chatId) : null;
				const change = {
					...((pane.status ?? null) === status ? {} : { status }),
					...(title === null || title === pane.title ? {} : { title }),
				};
				const key = `${workSessionId}/${pane.id}`;
				if (Object.keys(change).length === 0) {
					writing.delete(key);
					continue;
				}
				const pending = JSON.stringify(change);
				if (writing.get(key) === pending) continue;
				writing.set(key, pending);
				panes.methods
					.update({ workSessionId, paneId: pane.id, ...change })
					.catch((error: unknown) =>
						sdk.logger.warn(`Could not update pane ${key}: ${errorText(error)}`),
					)
					.finally(() => {
						if (writing.get(key) === pending) writing.delete(key);
					});
			}
		}
	}

	const follow = <T extends AnyDomainObject>(
		domainObject: T,
		onAdded: (handle: DomainObjectHandle<T>) => (() => void)[],
	) => {
		let stops: (() => void)[] = [];
		sdk.domainObjects.track(domainObject, {
			added: (handle) => {
				stops = [handle.subscribe(syncPanes), ...onAdded(handle)];
				syncPanes();
			},
			removed: () => {
				for (const stop of stops) stop();
				stops = [];
				syncPanes();
			},
		});
	};

	const openAllAdopted = () =>
		openAdoptedPanes(handles().workSessions?.getState().workSessions ?? []);

	follow(Panes, () => {
		openAllAdopted();
		return [];
	});
	follow(WorkSessions, (workSessions) => {
		openAllAdopted();
		return [workSessions.on("created", ({ workSession }) => openAdoptedPanes([workSession]))];
	});
	follow(Chats, () => []);
	follow(KernelWindows, () => []);
}
