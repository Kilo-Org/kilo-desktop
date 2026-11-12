import type { AnyDomainObject, DomainObjectHandle, PluginSdk } from "@kilo-desktop/kernel";
import { Chats, type ChatSummary } from "@kilo-desktop/plugin-core/contracts";
import {
	Panes,
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
 *   panes never outlives the turn it reported. Statuses are written only
 *   when they differ, and a write in flight is not repeated.
 */
export function activateChatPanes(sdk: PluginSdk): void {
	const writing = new Map<string, PaneStatus | null>();

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

	function syncStatuses(): void {
		const { panes, chats } = handles();
		if (!panes) return;
		const chatsState = chats?.getState() ?? null;
		for (const [workSessionId, record] of Object.entries(panes.getState().byWorkSession)) {
			for (const pane of record.panes) {
				const chatId = paneChat(pane);
				if (chatId === undefined) continue;
				const status = chatPaneStatus(chatsState, chatId);
				const key = `${workSessionId}/${pane.id}`;
				if ((pane.status ?? null) === status) {
					writing.delete(key);
					continue;
				}
				if (writing.has(key) && writing.get(key) === status) continue;
				writing.set(key, status);
				panes.methods
					.update({ workSessionId, paneId: pane.id, status })
					.catch((error: unknown) =>
						sdk.logger.warn(`Could not update pane ${key}'s status: ${errorText(error)}`),
					)
					.finally(() => {
						if (writing.get(key) === status) writing.delete(key);
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
				stops = [handle.subscribe(syncStatuses), ...onAdded(handle)];
				syncStatuses();
			},
			removed: () => {
				for (const stop of stops) stop();
				stops = [];
				syncStatuses();
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
}
