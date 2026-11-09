import { QueryClientProvider } from "@tanstack/react-query";
import { useCallback, useMemo, useRef, type FC } from "react";

import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";
import { Conversations } from "@kilo-desktop/plugin-agent/contracts";
import { Panes } from "@kilo-desktop/plugin-sessions/contracts";
import type { SessionStarterProps, StartedSession } from "@kilo-desktop/plugin-workbench/contracts";
import { Workspaces, type WorkspacesState } from "@kilo-desktop/plugin-workspaces/contracts";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { AGENT_PANE_KIND, CHAT_ID_METADATA_KEY, type ComposerContext } from "../../contracts";
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
 * something (kilo.workbench draws where the session runs above the starter).
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

const selectWorkspaces = (state: WorkspacesState) => state.workspaces;

/**
 * kilo.chat's session starter (`kilo.workbench/session-starter`): a chat with
 * no session yet. Its first send starts the session where the launcher says,
 * creates the chat there and an Agent pane for it, and opens the session once
 * the server has the message, so the pane shows it (or once the server
 * refused it, so the pane shows why). A session whose chat can't be created
 * is discarded again, the message going back to the composer. Either way the
 * starter ends a start with `open` or `discard`, which the New Session page
 * waits for.
 */
export function createChatSessionStarter(services: AgentPaneServices): FC<SessionStarterProps> {
	return function ChatSessionStarter({ workspaceId, directory, start }) {
		const conversations = useDomain(Conversations);
		const panes = useDomain(Panes);
		const workspaces = useDomainState(Workspaces, selectWorkspaces);
		const rootRef = useRef<HTMLDivElement>(null);
		const folders = useMemo(
			() =>
				(workspaces?.find((workspace) => workspace.id === workspaceId)?.folders ?? []).map(
					({ path, isPrimary }) => ({ path, isPrimary }),
				),
			[workspaces, workspaceId],
		);
		const latest = useRef({ start, folders });
		latest.current = { start, folders };
		const started = useRef<StartedSession | null>(null);

		const createChat = useCallback(async (): Promise<CreatedChat> => {
			if (!conversations) throw new Error("Kilo chats aren't available.");
			const session = await latest.current.start();
			try {
				const chat = await conversations.methods.create({
					sessionId: session.sessionId,
					...(session.directory ? { directory: session.directory } : {}),
					...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
					workspaceFolders: sessionFolders(latest.current.folders, session.directory),
					...(session.worktreeBranch ? { worktreeBranch: session.worktreeBranch } : {}),
				});
				await panes?.methods.open({
					sessionId: session.sessionId,
					kind: AGENT_PANE_KIND,
					metadata: { [CHAT_ID_METADATA_KEY]: chat.id },
				});
				started.current = session;
				return { id: chat.id, directory: chat.directory };
			} catch (error) {
				await session.discard().catch(() => undefined);
				throw error;
			}
		}, [conversations, panes]);

		/** Opens the session once its first message is sent, or failed: its chat then shows why. */
		const openStarted = useCallback(() => {
			const session = started.current;
			started.current = null;
			void session?.open();
		}, []);

		const directoryOf = useCallback(
			(id: string) => conversations?.getState().chats[id]?.directory ?? null,
			[conversations],
		);

		const getSystem = useCallback(
			async (id: string) => {
				const chat = conversations?.getState().chats[id];
				const config = await conversations?.methods
					.sessionConfig({
						sessionId: started.current?.sessionId ?? null,
						workspaceId: chat?.workspaceId ?? workspaceId,
						directory: chat?.directory ?? directory,
					})
					.catch(() => undefined);
				return chatSystemPrompt(
					chat?.workspaceFolders ?? sessionFolders(latest.current.folders, directory),
					config?.instructions ?? [],
				);
			},
			[conversations, directory, workspaceId],
		);

		const composer: ComposerContext = useMemo(
			() => ({ sessionId: null, chatId: null, directory, workspaceId, workspaceFolders: folders }),
			[directory, workspaceId, folders],
		);

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
							queueEditing={false}
							createChat={createChat}
							directoryOf={directoryOf}
							getSystem={getSystem}
							onChatId={() => undefined}
							onPrompted={openStarted}
							onPromptFailed={openStarted}
							focusRoot={() => focusComposerIn(rootRef.current)}
						>
							<StarterComposer />
						</ChatThread>
					</ChatConnectionProvider>
				</QueryClientProvider>
			</div>
		);
	};
}
