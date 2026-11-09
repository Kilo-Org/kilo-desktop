import { CheckIcon } from "lucide-react";
import { useCallback } from "react";

import type { DomainState } from "@kilo-desktop/kernel";
import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";
import { Conversations, type ChatSummary } from "@kilo-desktop/plugin-agent/contracts";
import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	type WorkSession,
} from "@kilo-desktop/plugin-sessions/contracts";
import type { PaneKindMenuProps } from "@kilo-desktop/plugin-workbench/contracts";
import {
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { toast } from "@kilo-desktop/ui/components/sonner";

import { AGENT_PANE_KIND, CHAT_ID_METADATA_KEY, agentPaneChatId } from "../../contracts";

/** A session's own chats (subagents excluded), newest first. */
export function sessionChats(
	session: Pick<WorkSession, "id" | "chatIds">,
	chats: Readonly<Record<string, ChatSummary>>,
): ChatSummary[] {
	const ids = new Set(session.chatIds);
	return Object.values(chats)
		.filter(
			(chat) => chat.parentId === null && (ids.has(chat.id) || chat.workSessionId === session.id),
		)
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * The agent kind's header menu entries (kilo.workbench/pane-kind-menu): the
 * session's chats, so one whose pane was closed can be reopened. An open one
 * is marked and shows its pane; a closed one opens an agent pane on it.
 * Newest activity first, as recents lists go.
 */
export function AgentChatsMenu({ session }: PaneKindMenuProps) {
	const panes = useDomain(Panes);
	const sessionPanes = useDomainState(
		Panes,
		useCallback(
			(state: DomainState<typeof Panes>) => state.bySession[session.id] ?? EMPTY_WORK_SESSION_PANES,
			[session.id],
		),
	);
	const chats = sessionChats(
		session,
		useDomainState(
			Conversations,
			useCallback((state: DomainState<typeof Conversations>) => state.chats, []),
		) ?? {},
	);
	if (!panes || chats.length === 0) return null;
	const agentPanes = (sessionPanes?.panes ?? []).filter((pane) => pane.kind === AGENT_PANE_KIND);
	const paneOf = (chatId: string) =>
		agentPanes.find((pane) => agentPaneChatId(pane, session, sessionPanes?.panes ?? []) === chatId);
	const show = (chatId: string) => {
		const open = paneOf(chatId);
		void (
			open
				? panes.methods.activate({ sessionId: session.id, paneId: open.id })
				: panes.methods.open({
						sessionId: session.id,
						kind: AGENT_PANE_KIND,
						metadata: { [CHAT_ID_METADATA_KEY]: chatId },
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
