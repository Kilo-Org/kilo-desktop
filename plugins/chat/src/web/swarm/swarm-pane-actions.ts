import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { Panes } from "@kilo-desktop/plugin-work-sessions/contracts";

import {
	AGENT_PANE_KIND,
	chatPaneObject,
	type Composer,
	paneChatId,
	SWARM_PANE_KIND,
	swarmPaneId,
} from "../../contracts";

/** Opens the root chat's Swarm Board, or brings its pane forward. */
export function openSwarmBoardPane(
	panes: DomainObjectHandle<typeof Panes>,
	workSessionId: string,
	rootChatId: string,
): Promise<unknown> {
	return panes.methods.open({
		workSessionId,
		kind: SWARM_PANE_KIND,
		paneId: swarmPaneId(rootChatId),
		title: "Swarm board",
		object: chatPaneObject(rootChatId),
	});
}

/**
 * Brings the chat's agent pane forward (opening one when none shows it), then
 * focuses its composer: the composer focuses the work session's active agent
 * pane, which this one now is.
 */
export async function focusChatComposer(
	panes: DomainObjectHandle<typeof Panes>,
	composer: DomainObjectHandle<typeof Composer> | null,
	workSessionId: string,
	chatId: string,
): Promise<void> {
	const existing = panes
		.getState()
		.byWorkSession[workSessionId]?.panes.find(
			(pane) => pane.kind === AGENT_PANE_KIND && paneChatId(pane) === chatId,
		);
	if (existing) await panes.methods.activate({ workSessionId, paneId: existing.id });
	else
		await panes.methods.open({
			workSessionId,
			kind: AGENT_PANE_KIND,
			object: chatPaneObject(chatId),
		});
	await composer?.methods.focus({ workSessionId });
}
