import { AssistantRuntimeProvider, useAui, useAuiEvent, useAuiState } from "@assistant-ui/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { BotIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FC, type ReactNode } from "react";

import type { DomainState } from "@kilo-desktop/kernel";
import { useContextKey, useDomain, useDomainState } from "@kilo-desktop/kernel/web";
import { Conversations, type CreateChatInput } from "@kilo-desktop/plugin-agent/contracts";
import { flagKey } from "@kilo-desktop/plugin-flags/contracts";
import { Panes, Sessions, type PaneProps } from "@kilo-desktop/plugin-sessions/contracts";
import { Workspaces, type WorkspacesState } from "@kilo-desktop/plugin-workspaces/contracts";
import { FIND_BAR_FEATURE_FLAG, FindScope } from "@kilo-desktop/ui/components/find-bar";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	agentPaneChatId,
	CHAT_ID_METADATA_KEY,
	PROMPT_QUEUE_EDITING_FLAG,
	type ComposerContext,
} from "../contracts";
import { ComposerContextContext, useComposerContext } from "./composer/composer-actions";
import { resolveMentionParts, type MentionSource } from "./composer/mention-codec";
import { useMentionSources } from "./composer/mention-triggers";
import { focusComposerIn, SESSION_ATTRIBUTE, type ComposerFocus } from "./composer-focus";
import type { CreatedChat } from "./runtime/chat-backend";
import { ChatConnectionProvider, useChatConnection } from "./runtime/chat-connection";
import type { ChatServices } from "./runtime/chat-services";
import type { PromptPart } from "./runtime/prompt-options";
import { chatSystemPrompt, sessionFolders, type PromptFolder } from "./runtime/system-prompt";
import { useChatRuntime } from "./runtime/use-chat-runtime";
import { ComposerSelectionProvider, type PromptSelection } from "./selection/composer-selection";
import { prepareForPrompt, useModelSourcesRef } from "./selection/model-source";
import { useKiloCommandCatalog } from "./slash-commands/use-kilo-command-catalog";
import { ChatPaneOpeners } from "./panes/chat-pane-openers";
import { FollowPlanApproval } from "./plan/follow-plan-approval";
import { Thread } from "./thread/thread";
import { TranscriptProviders, useTranscriptAui } from "./thread/transcript-scope";

export const AgentIcon: FC<{ className?: string }> = ({ className }) => (
	<BotIcon className={className} />
);

export interface AgentPaneServices {
	readonly chat: ChatServices;
	readonly focus: ComposerFocus;
	/** The window's query cache: Kilo's agent, model and command catalogs. */
	readonly queries: QueryClient;
}

interface ChatContext {
	readonly sessionId: string;
	readonly paneId: string;
	readonly paneMetadata: Readonly<Record<string, string>>;
	readonly workspaceId: string | null;
	readonly directory: string | null;
	readonly worktreeBranch: string | null;
	readonly folders: readonly PromptFolder[];
	readonly sessionDirectory: string | null;
	readonly sessionChatIds: readonly string[];
}

/** Says why a draft's first send failed; the message goes back to the composer. */
function reportStartFailure(error: unknown): void {
	console.error("[kilo.chat] Could not start the chat", error);
	toast.error("Could not start the chat", {
		description:
			error instanceof Error && error.message
				? error.message
				: "Your message was returned to the composer.",
	});
}

/**
 * The agent pane, bound to its window's services: a session's chat (the one
 * named in the pane, else the session's first) or a draft whose first send
 * creates the chat in the session's folder and records it in the pane.
 */
export function createAgentPane(services: AgentPaneServices): FC<PaneProps> {
	return function AgentPane({ sessionId, pane, workspaceId, directory }) {
		const session = useDomainState(
			Sessions,
			useCallback(
				(state: DomainState<typeof Sessions>) =>
					state.sessions.find((candidate) => candidate.id === sessionId),
				[sessionId],
			),
		);
		const workspace = useDomainState(
			Workspaces,
			useCallback(
				(state: WorkspacesState) =>
					state.workspaces.find((candidate) => candidate.id === workspaceId),
				[workspaceId],
			),
		);
		const conversations = useDomain(Conversations);
		const panes = useDomain(Panes);
		const findEnabled = useContextKey(flagKey(FIND_BAR_FEATURE_FLAG));
		const queueEditing = useContextKey(flagKey(PROMPT_QUEUE_EDITING_FLAG));
		const rootRef = useRef<HTMLDivElement>(null);

		const chatId = agentPaneChatId(pane, session);
		const context: ChatContext = {
			sessionId,
			paneId: pane.id,
			paneMetadata: pane.metadata,
			workspaceId,
			directory,
			worktreeBranch: session?.worktreeBranch ?? null,
			folders: sessionFolders(
				(workspace?.folders ?? []).map(({ path, isPrimary }) => ({ path, isPrimary })),
				directory,
			),
			sessionDirectory: session?.directory ?? null,
			sessionChatIds: session?.chatIds ?? [],
		};
		const latest = useRef(context);
		latest.current = context;

		// The chat the mounted runtime shows. While a draft creates its chat the
		// session may list it before the pane records it; neither may remount the
		// thread that is sending the first message.
		const shownChatId = useRef(chatId);
		const creating = useRef(false);
		const [mounted, setMounted] = useState({ generation: 0, chatId });
		if (!creating.current && chatId !== mounted.chatId && chatId !== shownChatId.current) {
			shownChatId.current = chatId;
			setMounted({ generation: mounted.generation + 1, chatId });
		}

		const createChat = useCallback(async (): Promise<CreatedChat> => {
			if (!conversations) throw new Error("Kilo chats aren't available.");
			const current = latest.current;
			const input: CreateChatInput = {
				sessionId: current.sessionId,
				...(current.directory ? { directory: current.directory } : {}),
				...(current.workspaceId ? { workspaceId: current.workspaceId } : {}),
				workspaceFolders: [...current.folders],
				...(current.worktreeBranch ? { worktreeBranch: current.worktreeBranch } : {}),
			};
			creating.current = true;
			const chat = await conversations.methods.create(input).finally(() => {
				creating.current = false;
			});
			shownChatId.current = chat.id;
			// kilo.sessions attaches the chat to the session on its own (it was
			// created for it), so a failed record only loses the pane's pointer.
			await panes?.methods
				.update({
					sessionId: current.sessionId,
					paneId: current.paneId,
					metadata: { ...current.paneMetadata, [CHAT_ID_METADATA_KEY]: chat.id },
				})
				.catch(() => undefined);
			return { id: chat.id, directory: chat.directory };
		}, [conversations, panes]);

		const directoryOf = useCallback(
			(id: string) => {
				const known = conversations?.getState().chats[id]?.directory;
				if (known) return known;
				const current = latest.current;
				return current.sessionChatIds.includes(id) ? current.sessionDirectory : null;
			},
			[conversations],
		);

		const getSystem = useCallback(
			async (id: string) => {
				const current = latest.current;
				const folders = conversations?.getState().chats[id]?.workspaceFolders ?? current.folders;
				const config = await conversations?.methods
					.sessionConfig({
						sessionId: current.sessionId,
						workspaceId: current.workspaceId,
						directory: current.directory,
					})
					.catch(() => undefined);
				return chatSystemPrompt(folders, config?.instructions ?? []);
			},
			[conversations],
		);

		const folderKey = JSON.stringify(
			workspace?.folders.map(({ path, isPrimary }) => [path, isPrimary]),
		);
		const composer: ComposerContext = useMemo(
			() => ({
				sessionId,
				chatId: mounted.chatId,
				directory,
				workspaceId,
				workspaceFolders: (JSON.parse(folderKey ?? "[]") as [string, boolean][]).map(
					([path, isPrimary]) => ({ path, isPrimary }),
				),
			}),
			[sessionId, mounted.chatId, directory, workspaceId, folderKey],
		);

		return (
			<div
				ref={rootRef}
				className="flex h-full min-h-0 flex-col"
				data-qa-id="kilo-agent-pane"
				{...{ [SESSION_ATTRIBUTE]: sessionId }}
			>
				<FindScope
					enabled={findEnabled}
					className="flex min-h-0 flex-1 flex-col"
					searchRootSelector='[data-slot="aui_message-group"]'
					qaPrefix="chat-find"
					placeholder="Find in transcript"
				>
					<QueryClientProvider client={services.queries}>
						<ChatConnectionProvider services={services.chat}>
							<ChatThread
								key={mounted.generation}
								chatId={mounted.chatId}
								services={services.chat}
								focus={services.focus}
								paneId={pane.id}
								composer={composer}
								queueEditing={queueEditing}
								createChat={createChat}
								directoryOf={directoryOf}
								getSystem={getSystem}
								onChatId={(id) => {
									if (id) shownChatId.current = id;
								}}
								focusRoot={() => focusComposerIn(rootRef.current)}
							>
								<Thread />
							</ChatThread>
						</ChatConnectionProvider>
					</QueryClientProvider>
				</FindScope>
			</div>
		);
	};
}

export interface ChatThreadProps {
	readonly chatId: string | null;
	readonly services: ChatServices;
	readonly focus: ComposerFocus;
	readonly paneId: string;
	readonly composer: ComposerContext;
	readonly queueEditing: boolean;
	readonly createChat: () => Promise<CreatedChat>;
	readonly directoryOf: (chatId: string) => string | null;
	readonly getSystem: (chatId: string) => Promise<string | undefined>;
	readonly onChatId: (chatId: string | undefined) => void;
	readonly onPrompted?: (chatId: string) => void;
	readonly focusRoot: () => void;
	/** What shows the thread: the transcript and composer, or the New Session page's composer. */
	readonly children: ReactNode;
}

/**
 * A chat's runtime and the providers its transcript and composer read, around
 * `children`. Registered with the window's composer domain while it belongs
 * to a session.
 */
export function ChatThread({
	composer,
	focus,
	paneId,
	focusRoot,
	children,
	...options
}: ChatThreadProps) {
	const selection = useRef<PromptSelection>({});
	const commandNames = useRef<readonly string[]>([]);
	const sources = useRef<readonly MentionSource[]>([]);
	sources.current = useMentionSources();
	const latestComposer = useRef(composer);
	latestComposer.current = composer;
	const modelSources = useModelSourcesRef();
	const runtime = useChatRuntime({
		...options,
		onCreateFailed: reportStartFailure,
		getAgent: () => selection.current.agent,
		getModel: () => selection.current.model,
		getVariant: () => selection.current.variant,
		getKnownCommandNames: () => commandNames.current,
		prepareModel: (model) => prepareForPrompt(model, modelSources.current),
		resolveParts: (parts: readonly PromptPart[]) => {
			const { chatId: _chatId, ...context } = latestComposer.current;
			return resolveMentionParts(parts, sources.current, context);
		},
	});
	const aui = useTranscriptAui();
	return (
		<AssistantRuntimeProvider aui={aui} runtime={runtime}>
			<ComposerContextProvider composer={composer}>
				<ComposerSelectionProvider
					draft={options.chatId === null}
					onSelection={(next) => {
						selection.current = next;
					}}
				>
					<CommandNames directory={composer.directory} names={commandNames} />
					{composer.sessionId ? (
						<ComposerRegistration
							focus={focus}
							sessionId={composer.sessionId}
							paneId={paneId}
							focusRoot={focusRoot}
						/>
					) : null}
					<FollowPlanApproval />
					<ThreadPaneOpeners>
						<TranscriptProviders
							sessionId={composer.sessionId}
							workspaceFolders={composer.workspaceFolders}
						>
							{children}
						</TranscriptProviders>
					</ThreadPaneOpeners>
				</ComposerSelectionProvider>
			</ComposerContextProvider>
		</AssistantRuntimeProvider>
	);
}

/** The composer's context, with the chat the thread shows once a draft has created it. */
function ComposerContextProvider({
	composer,
	children,
}: {
	composer: ComposerContext;
	children: ReactNode;
}) {
	const remoteId = useAuiState((state) => state.threadListItem.remoteId) ?? null;
	const value = useMemo(
		() => (remoteId && remoteId !== composer.chatId ? { ...composer, chatId: remoteId } : composer),
		[composer, remoteId],
	);
	return (
		<ComposerContextContext.Provider value={value}>{children}</ComposerContextContext.Provider>
	);
}

/** Pane openers for the chat the thread shows, once a draft has created it too. */
function ThreadPaneOpeners({ children }: { children: ReactNode }) {
	const { sessionId, chatId } = useComposerContext();
	return (
		<ChatPaneOpeners sessionId={sessionId} chatId={chatId}>
			{children}
		</ChatPaneOpeners>
	);
}

/** Keeps Kilo's slash command names for the chat's folder where prompts can read them. */
function CommandNames({
	directory,
	names,
}: {
	directory: string | null;
	names: { current: readonly string[] };
}) {
	const { connection } = useChatConnection();
	const catalog = useKiloCommandCatalog(connection, directory ?? undefined);
	names.current = useMemo(
		() => (catalog.data ?? []).map((command) => command.name),
		[catalog.data],
	);
	return null;
}

/** Registers the pane's composer with the window's composer domain and keeps its draft. */
function ComposerRegistration({
	focus,
	sessionId,
	paneId,
	focusRoot,
}: {
	focus: ComposerFocus;
	sessionId: string;
	paneId: string;
	focusRoot: () => void;
}) {
	const aui = useAui();
	const text = useAuiState((state) => state.composer.text);
	// Registering prefills an empty composer with the session's draft, so it
	// must happen once per mount: a re-run while a send has just emptied the
	// composer (before its draft is cleared) would put the sent text back.
	const latestFocusRoot = useRef(focusRoot);
	latestFocusRoot.current = focusRoot;
	useEffect(
		() =>
			focus.register({
				sessionId,
				paneId,
				focus: () => latestFocusRoot.current(),
				getText: () => aui.composer.getState().text,
				setText: (next) => aui.composer.setText(next),
			}),
		[aui, focus, paneId, sessionId],
	);
	useEffect(() => focus.setDraft(sessionId, text), [focus, sessionId, text]);
	useAuiEvent("composer.send", () => focus.setDraft(sessionId, ""));
	return null;
}
