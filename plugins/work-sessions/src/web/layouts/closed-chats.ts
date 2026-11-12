import { isRef, ref, type ObjectRef } from "@kilo-desktop/kernel";
import { Chat } from "@kilo-desktop/plugin-core/contracts";

import type { Pane, WorkSession } from "../../contracts";
import type { ChatsById } from "../attention/session-chats";
import type { ClosedObject } from "./layout-template";

/**
 * A work session's chats that no pane shows, most recently active first (a
 * chat kilo.core hasn't listed yet goes last), each with the pane kind its
 * `opener` names; chats nothing opens are left out. Subagent chats are not
 * the session's own.
 */
export function closedChatsOf(
	workSession: Pick<WorkSession, "id" | "chatIds">,
	chats: ChatsById,
	panes: readonly Pane[],
	openerOf: (object: ObjectRef) => string | undefined,
): ClosedObject[] {
	const shown = new Set(
		panes.flatMap((pane) => (isRef(Chat, pane.object) ? [pane.object.id] : [])),
	);
	const own = new Set(workSession.chatIds);
	for (const chat of Object.values(chats)) {
		if (chat.workSessionId === workSession.id) own.add(chat.id);
	}
	const activity = (id: string) => chats[id]?.updatedAt ?? Number.NEGATIVE_INFINITY;
	return [...own]
		.filter((id) => !shown.has(id) && (chats[id]?.parentId ?? null) === null)
		.sort((a, b) => activity(b) - activity(a) || 0)
		.flatMap((id) => {
			const object = ref(Chat, id);
			const kind = openerOf(object);
			return kind ? [{ kind, object }] : [];
		});
}
