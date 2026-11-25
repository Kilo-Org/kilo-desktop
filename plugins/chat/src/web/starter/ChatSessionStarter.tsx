import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useRef, type FC } from "react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Chats } from "@kilo-desktop/plugin-core/contracts";
import {
	Panes,
	WorkSessions,
	Workspaces,
	type StartedWorkSession,
	type WorkSessionStarterProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { AGENT_PANE_KIND, chatPaneObject, type ComposerContext } from "../../contracts";
import { ChatThread, type AgentPaneServices } from "../AgentPane";
import { Composer } from "../composer/composer";
import { ComposerActionSlotView } from "../composer/composer-actions";
import { focusComposerIn } from "../composer-focus";
import type { CreatedChat } from "../runtime/chat-backend";
import { ChatConnectionProvider } from "../runtime/chat-connection";
import { chatSystemPrompt, sessionFolders } from "../runtime/system-prompt";

import "../thread/composer.css";

/** Chat text size in place of the UI one, as in the thread. */
const CHAT_TYPOGRAPHY_CLASS =
	"[--app-ui-text-size:var(--app-chat-text-size)] [--leading-relaxed:1.5]";

/**
 * Origin's draft composer on the New Session page, with the `draft-footer`
 * composer actions in a strip tucked under it while any of them shows
 * something (kilo.work-sessions draws where the work session runs above the
 * starter).
 */
function StarterComposer() {
	return (
		<div
			data-qa-id="kilo-session-starter"
			className={cn(
				"aui-root @container chat-starter-flat flex w-full flex-col [--composer-bg:var(--composer-draft,var(--color-card))]",
				CHAT_TYPOGRAPHY_CLASS,
			)}
			style={{
				["--composer-radius" as string]: "1rem",
				["--composer-padding" as string]: "8px",
			}}
		>
			<div className="relative z-10">
				<Composer isDraft />
			</div>
			<div
				data-qa-id="kilo-composer-draft-footer"
				className="border-border-subtle bg-foreground/[0.06] dark:bg-muted relative z-0 -mt-(--composer-radius) flex w-full items-center justify-between gap-2 rounded-b-(--composer-radius) border border-t-0 px-1 pt-5 pb-1 has-[>[data-slot=composer-draft-actions]:empty]:hidden"
			>
				<div data-slot="composer-draft-actions" className="flex min-w-0 flex-1 items-center gap-1">
					<ComposerActionSlotView slot="draft-footer" />
				</div>
			</div>
		</div>
	);
}

const selectWorkspaces = (state: DomainObjectState<typeof Workspaces>) => state.workspaces;

function workspaceFolders(
	workspaces: DomainObjectState<typeof Workspaces>["workspaces"] | undefined,
	workspaceId: string | null,
): ComposerContext["workspaceFolders"] {
	return (workspaces?.find((workspace) => workspace.id === workspaceId)?.folders ?? []).map(
		({ path, isPrimary }) => ({ path, isPrimary }),
	);
}

/**
 * kilo.chat's work session starter (`kilo.work-sessions/work-session-starter`):
 * a chat with no work session yet. Its first send starts the work session
 * where the New Session page says, creates the chat in it (stamped by
 * kilo.work-sessions) and an Agent pane showing it, and opens the work
 * session once the server has the message, so the pane shows it (or once
 * the server refused it, so the pane shows why). A work session whose chat
 * can't be created is discarded again, the message going back to the
 * composer. Either way the starter ends a start with `open` or `discard`,
 * which the New Session page waits for. The page may close first (another
 * session opened while a worktree is made): the message then goes to main's
 * prompt queue once the chat exists, or else to the new work session's draft,
 * and the work session isn't opened. Each `focusRequest` (New session)
 * focuses the composer.
 */
export function createChatSessionStarter(services: AgentPaneServices): FC<WorkSessionStarterProps> {
	return (props) => <ChatSessionStarter {...props} services={services} />;
}

function ChatSessionStarter({
	workspaceId,
	directory,
	start,
	focusRequest,
	services,
}: WorkSessionStarterProps & { services: AgentPaneServices }) {
	const chats = useDomainObject(Chats);
	const workSessions = useDomainObject(WorkSessions);
	const panes = useDomainObject(Panes);
	const workspaces = useDomainObjectState(Workspaces, selectWorkspaces);
	const rootRef = useRef<HTMLDivElement>(null);
	const latestStart = useLatestRef(start);
	const started = useRef<StartedWorkSession | null>(null);

	useEffect(() => {
		if (!focusRequest) return;
		// After the editor has mounted, when the page was just shown.
		const frame = requestAnimationFrame(() => focusComposerIn(rootRef.current));
		return () => cancelAnimationFrame(frame);
	}, [focusRequest]);
	const folders = workspaceFolders(workspaces, workspaceId);

	const createChat = async (): Promise<CreatedChat> => {
		if (!workSessions || !chats) throw new Error("Kilo chats aren't available.");
		const workSession = await latestStart.current();
		try {
			const chat = await workSessions.methods.createChat({ id: workSession.workSessionId });
			await panes?.methods.open({
				workSessionId: workSession.workSessionId,
				kind: AGENT_PANE_KIND,
				object: chatPaneObject(chat.id),
			});
			started.current = workSession;
			return { id: chat.id, directory: chat.directory, workSessionId: workSession.workSessionId };
		} catch (error) {
			await workSession.discard().catch(() => undefined);
			throw error;
		}
	};

	/** Opens the work session once its first message is sent, or failed: its chat then shows why. */
	const openStarted = () => {
		const workSession = started.current;
		started.current = null;
		void workSession?.open();
	};

	const getSystem = async (id: string) => {
		const chat = chats?.getState().chats[id];
		const config = await chats?.methods
			.chatConfig({
				chatId: id,
				workSessionId: chat?.workSessionId ?? started.current?.workSessionId ?? null,
				workspaceId: chat?.workspaceId ?? workspaceId,
				directory: chat?.directory ?? directory,
			})
			.catch(() => undefined);
		const chatFolders = chat?.workspaceFolders.length ? chat.workspaceFolders : folders;
		return chatSystemPrompt(
			sessionFolders(chatFolders, chat?.directory ?? directory),
			config?.instructions ?? [],
		);
	};

	const composer: ComposerContext = {
		workSessionId: null,
		chatId: null,
		directory,
		workspaceId,
		workspaceFolders: folders,
	};

	return (
		<div ref={rootRef} className="w-full">
			<QueryClientProvider client={services.queries}>
				<ChatConnectionProvider services={services.chat}>
					<ChatThread
						chatId={null}
						services={services.chat}
						focus={services.focus}
						paneId="new-session"
						composer={composer}
						createChat={createChat}
						getSystem={getSystem}
						onChatId={() => undefined}
						onPrompted={openStarted}
						onPromptFailed={openStarted}
						handOverFirstPrompt
						focusRoot={() => focusComposerIn(rootRef.current)}
					>
						<StarterComposer />
					</ChatThread>
				</ChatConnectionProvider>
			</QueryClientProvider>
		</div>
	);
}
