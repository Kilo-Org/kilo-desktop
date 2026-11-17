import { BotIcon, ExternalLinkIcon, PlusIcon } from "lucide-react";
import { useCallback, type ReactNode } from "react";

import { KernelWindows, type DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Chats, type ChatSummary } from "@kilo-desktop/plugin-core/contracts";
import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	paneWindows,
	type Pane,
	type WorkSession,
	type WorkSessionActionProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import {
	PANE_TAB_STATUS_ICON_CLASS_NAME,
	PaneTabStatusIcon,
} from "@kilo-desktop/ui/components/pane-tabs";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { AGENT_PANE_KIND, chatPaneObject, paneChatId } from "../../contracts";
import { AgentIcon } from "../AgentPane";

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

/** The work session's popped-out panes: pane id → window id. */
function usePaneWindowIds(workSessionId: string): ReadonlyMap<string, string> {
	const serialized = useDomainObjectState(
		KernelWindows,
		useCallback(
			(state: DomainObjectState<typeof KernelWindows>) =>
				paneWindows(state)
					.filter((window) => window.workSessionId === workSessionId)
					.map((window) => `${window.paneId}\n${window.windowId}`)
					.join("\t"),
			[workSessionId],
		),
	);
	return new Map(
		serialized ? serialized.split("\t").map((entry) => entry.split("\n") as [string, string]) : [],
	);
}

/**
 * The Agents button in the open work session's header
 * (kilo.work-sessions/work-session-action): New agent (a draft tab), then
 * the work session's chats, those
 * with an agent tab first in tab order (with each tab's status, and a mark
 * on a popped-out one), then closed ones newest first. Picking an open chat
 * shows its tab or brings its window forward; picking a closed one reopens it.
 */
export function AgentsMenu({ workSession }: WorkSessionActionProps) {
	const panes = useDomainObject(Panes);
	const windows = useDomainObject(KernelWindows);
	const workSessionPanes = useDomainObjectState(
		Panes,
		useCallback(
			(state: DomainObjectState<typeof Panes>) =>
				state.byWorkSession[workSession.id] ?? EMPTY_WORK_SESSION_PANES,
			[workSession.id],
		),
	);
	const chats =
		useDomainObjectState(
			Chats,
			useCallback((state: DomainObjectState<typeof Chats>) => state.chats, []),
		) ?? {};
	const poppedOut = usePaneWindowIds(workSession.id);
	if (!panes) return null;
	const all = workSessionPanes?.panes ?? [];
	const paneByChat = new Map<string, Pane>();
	for (const pane of all) {
		if (pane.kind !== AGENT_PANE_KIND) continue;
		const chatId = paneChatId(pane);
		if (chatId && !paneByChat.has(chatId)) paneByChat.set(chatId, pane);
	}
	const own = workSessionChats(workSession, chats);
	const open = [...paneByChat].flatMap(([chatId, pane]) => {
		const chat = chats[chatId];
		return chat ? [{ chat, pane }] : [];
	});
	const closed = own.filter((chat) => !paneByChat.has(chat.id));
	const failed = (what: string) => () => toast.error(`Could not ${what}`);

	const show = (pane: Pane) => {
		const windowId = poppedOut.get(pane.id);
		if (windowId && windows) {
			void windows.methods.focus({ windowId }).catch(failed("show the window"));
			return;
		}
		void panes.methods
			.activate({ workSessionId: workSession.id, paneId: pane.id })
			.catch(failed("show the chat"));
	};
	const reopen = (chatId: string) =>
		void panes.methods
			.open({
				workSessionId: workSession.id,
				kind: AGENT_PANE_KIND,
				object: chatPaneObject(chatId),
				placement: "tab",
			})
			.catch(failed("open the chat"));
	const startNew = () =>
		void panes.methods
			.open({ workSessionId: workSession.id, kind: AGENT_PANE_KIND, placement: "tab" })
			.catch(failed("start a new agent"));

	const row = (chat: ChatSummary, icon: ReactNode, trailing: ReactNode, onClick: () => void) => (
		<DropdownMenuItem key={chat.id} data-qa-id={`agents-menu-${chat.id}`} onClick={onClick}>
			{icon}
			<span className="min-w-0 flex-1 truncate">{chat.title || "New chat"}</span>
			{trailing}
		</DropdownMenuItem>
	);

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger
					render={
						<DropdownMenuTrigger
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label="Agents"
									data-qa-id="agents-menu-button"
								/>
							}
						/>
					}
				>
					<BotIcon className="size-3.5" aria-hidden />
				</TooltipTrigger>
				<TooltipContent side="bottom">Agents</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end" className="w-72" data-qa-id="agents-menu">
				<DropdownMenuItem data-qa-id="agents-menu-new" onClick={startNew}>
					<PlusIcon className="size-3.5" aria-hidden />
					New agent
				</DropdownMenuItem>
				{open.length > 0 || closed.length > 0 ? <DropdownMenuSeparator /> : null}
				{open.length > 0 ? (
					<DropdownMenuGroup>
						<DropdownMenuLabel>Open</DropdownMenuLabel>
						{open.map(({ chat, pane }) => {
							const status = pane.status ?? null;
							return row(
								chat,
								<PaneTabStatusIcon status={status}>
									<AgentIcon
										{...(status ? { status } : {})}
										className={cn("size-3.5", status && PANE_TAB_STATUS_ICON_CLASS_NAME[status])}
									/>
								</PaneTabStatusIcon>,
								poppedOut.has(pane.id) ? (
									<ExternalLinkIcon
										className="text-muted-foreground size-3"
										aria-label="In its own window"
										role="img"
									/>
								) : null,
								() => show(pane),
							);
						})}
					</DropdownMenuGroup>
				) : null}
				{open.length > 0 && closed.length > 0 ? <DropdownMenuSeparator /> : null}
				{closed.length > 0 ? (
					<DropdownMenuGroup>
						<DropdownMenuLabel>Closed</DropdownMenuLabel>
						{closed.map((chat) =>
							row(chat, <AgentIcon className="text-muted-foreground size-3.5" />, null, () =>
								reopen(chat.id),
							),
						)}
					</DropdownMenuGroup>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
