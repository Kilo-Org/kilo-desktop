import { CheckIcon } from "lucide-react";
import { useCallback } from "react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Chats, type ChatSummary } from "@kilo-desktop/plugin-core/contracts";
import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	type PaneKindMenuProps,
	type WorkSession,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { AGENT_PANE_KIND, paneChatId, chatPaneObject } from "../../contracts";

/** A work session's own chats (subagents excluded), newest first. */
export function workSessionChats(
	workSession: Pick<WorkSession, "id" | "chatIds">,
	chats: Readonly<Record<string, ChatSummary>>,
): ChatSummary[] {
	const ids = new Set(workSession.chatIds);
	return Object.values(chats)
		.filter(
			(chat) =>
				chat.parentId === null && (ids.has(chat.id) || chat.workSessionId === workSession.id),
		)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The agent kind's header menu entries (kilo.work-sessions/pane-kind-menu):
 * the work session's chats, so one whose pane was closed can be reopened. An open one
 * is marked and shows its pane; a closed one opens an agent pane on it.
 * Newest activity first, as recents lists go.
 */
export function AgentChatsMenu({ workSession }: PaneKindMenuProps) {
	const panes = useDomainObject(Panes);
	const workSessionPanes = useDomainObjectState(
		Panes,
		useCallback(
			(state: DomainObjectState<typeof Panes>) =>
				state.byWorkSession[workSession.id] ?? EMPTY_WORK_SESSION_PANES,
			[workSession.id],
		),
	);
	const chats = workSessionChats(
		workSession,
		useDomainObjectState(
			Chats,
			useCallback((state: DomainObjectState<typeof Chats>) => state.chats, []),
		) ?? {},
	);
	if (!panes || chats.length === 0) return null;
	const all = workSessionPanes?.panes ?? [];
	const agentPanes = all.filter((pane) => pane.kind === AGENT_PANE_KIND);
	const paneOf = (chatId: string) => agentPanes.find((pane) => paneChatId(pane) === chatId);
	const show = (chatId: string) => {
		const open = paneOf(chatId);
		void (
			open
				? panes.methods.activate({ workSessionId: workSession.id, paneId: open.id })
				: panes.methods.open({
						workSessionId: workSession.id,
						kind: AGENT_PANE_KIND,
						object: chatPaneObject(chatId),
					})
		).catch(() => toast.error("Could not open the chat"));
	};
	return (
		<>
			<DropdownMenuSeparator />
			<DropdownMenuGroup>
				<DropdownMenuLabel>Chats</DropdownMenuLabel>
				{chats.map((chat) => (
					<DropdownMenuItem
						key={chat.id}
						data-qa-id={`agent-chat-${chat.id}`}
						onClick={() => show(chat.id)}
					>
						<span className="min-w-0 flex-1 truncate">{chat.title || "New chat"}</span>
						{paneOf(chat.id) ? (
							<CheckIcon aria-label="Open" className="text-muted-foreground" />
						) : null}
					</DropdownMenuItem>
				))}
			</DropdownMenuGroup>
		</>
	);
}
