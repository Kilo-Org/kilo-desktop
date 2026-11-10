import { AssistantRuntimeProvider, useAui, useAuiEvent, useAuiState } from "@assistant-ui/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { BotIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FC, type ReactNode } from "react";

import { flagKey, type DomainObjectState } from "@kilo-desktop/kernel";
import { useContextKey, useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Chats } from "@kilo-desktop/plugin-core/contracts";
import {
	Panes,
	WorkSessions,
	Workspaces,
	type Pane,
	type PaneProps,
	type WorkspacesState,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { FindScope } from "@kilo-desktop/ui/components/find-bar";
import { toast } from "@kilo-desktop/ui/components/sonner";

import {
	agentPaneChatId,
	chatPaneObject,
	FIND_BAR_FLAG,
	PROMPT_QUEUE_EDITING_FLAG,
	type ComposerContext,
	type PromptPart as MentionPart,
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
	readonly workSessionId: string;
	readonly paneId: string;
	readonly workspaceId: string | null;
	readonly directory: string | null;
	readonly folders: readonly PromptFolder[];
	readonly workSessionDirectory: string | null;
	readonly workSessionChatIds: readonly string[];
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

const NO_PANES: readonly Pane[] = [];

/**
 * The agent pane, bound to its window's services: a work session's chat (the
 * pane's `object`, else for the work session's first agent pane its first
 * chat) or a draft whose first send creates a chat in the work session
 * (`WorkSessions.createChat`) and makes it the pane's `object`. A work
 * session can hold several, each its own chat.
 */
export function createAgentPane(services: AgentPaneServices): FC<PaneProps> {
	return function AgentPane({ workSessionId, pane, workspaceId, directory }) {
		const workSession = useDomainObjectState(
			WorkSessions,
			useCallback(
				(state: DomainObjectState<typeof WorkSessions>) =>
					state.workSessions.find((candidate) => candidate.id === workSessionId),
				[workSessionId],
			),
		);
		const workspace = useDomainObjectState(
			Workspaces,
			useCallback(
				(state: WorkspacesState) =>
					state.workspaces.find((candidate) => candidate.id === workspaceId),
				[workspaceId],
			),
		);
		const workSessionPanes = useDomainObjectState(
			Panes,
			useCallback(
				(state: DomainObjectState<typeof Panes>) =>
					state.byWorkSession[workSessionId]?.panes ?? NO_PANES,
				[workSessionId],
			),
		);
		const chats = useDomainObject(Chats);
		const workSessions = useDomainObject(WorkSessions);
		const panes = useDomainObject(Panes);
		const findEnabled = useContextKey(flagKey(FIND_BAR_FLAG));
		const queueEditing = useContextKey(flagKey(PROMPT_QUEUE_EDITING_FLAG));
		const rootRef = useRef<HTMLDivElement>(null);

		const chatId = agentPaneChatId(pane, workSession, workSessionPanes ?? NO_PANES);
		const context: ChatContext = {
			workSessionId,
			paneId: pane.id,
			workspaceId,
			directory,
			folders: sessionFolders(
				(workspace?.folders ?? []).map(({ path, isPrimary }) => ({ path, isPrimary })),
				directory,
			),
			workSessionDirectory: workSession?.directory ?? null,
			workSessionChatIds: workSession?.chatIds ?? [],
		};
		const latest = useRef(context);
		latest.current = context;

		// The chat the mounted runtime shows. While a draft creates its chat the
		// work session may list it before the pane records it; neither may remount the
		// thread that is sending the first message.
		const shownChatId = useRef(chatId);
		const creating = useRef(false);
		const [mounted, setMounted] = useState({ generation: 0, chatId });
		if (!creating.current && chatId !== mounted.chatId && chatId !== shownChatId.current) {
			shownChatId.current = chatId;
			setMounted({ generation: mounted.generation + 1, chatId });
		}

		const createChat = useCallback(async (): Promise<CreatedChat> => {
			if (!workSessions) throw new Error("Kilo chats aren't available.");
			const current = latest.current;
			creating.current = true;
			const chat = await workSessions.methods
				.createChat({ id: current.workSessionId })
				.finally(() => {
					creating.current = false;
				});
			shownChatId.current = chat.id;
			// kilo.work-sessions lists the chat in the work session on its own
			// (it is stamped with it), so a failed update only loses the pane's
			// pointer.
			await panes?.methods
				.update({
					workSessionId: current.workSessionId,
					paneId: current.paneId,
					object: chatPaneObject(chat.id),
				})
				.catch(() => undefined);
			return { id: chat.id, directory: chat.directory };
		}, [workSessions, panes]);

		const directoryOf = useCallback(
			(id: string) => {
				const known = chats?.getState().chats[id]?.directory;
				if (known) return known;
				const current = latest.current;
				return current.workSessionChatIds.includes(id) ? current.workSessionDirectory : null;
			},
			[chats],
		);

		const getSystem = useCallback(
			async (id: string) => {
				const current = latest.current;
				const folders = chats?.getState().chats[id]?.workspaceFolders ?? current.folders;
				const config = await chats?.methods
					.chatConfig({
						chatId: id,
						workSessionId: current.workSessionId,
						workspaceId: current.workspaceId,
						directory: current.directory,
					})
					.catch(() => undefined);
				return chatSystemPrompt(folders, config?.instructions ?? []);
			},
			[chats],
		);

		const folderKey = JSON.stringify(
			workspace?.folders.map(({ path, isPrimary }) => [path, isPrimary]),
		);
		const composer: ComposerContext = useMemo(
			() => ({
				workSessionId,
				chatId: mounted.chatId,
				directory,
				workspaceId,
				workspaceFolders: (JSON.parse(folderKey ?? "[]") as [string, boolean][]).map(
					([path, isPrimary]) => ({ path, isPrimary }),
				),
			}),
			[workSessionId, mounted.chatId, directory, workspaceId, folderKey],
		);

		return (
			<div
				ref={rootRef}
				className="flex h-full min-h-0 flex-col"
				data-qa-id="kilo-agent-pane"
				{...{ [SESSION_ATTRIBUTE]: workSessionId }}
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
	readonly onPromptFailed?: (chatId: string) => void;
	readonly focusRoot: () => void;
	/** What shows the thread: the transcript and composer, or the New Session page's composer. */
	readonly children: ReactNode;
}

/**
 * A chat's runtime and the providers its transcript and composer read, around
 * `children`. Registered with the window's composer domain while it belongs
 * to a work session.
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
			// Only text parts are rewritten; the rest pass through as they came.
			return resolveMentionParts(parts as readonly MentionPart[], sources.current, context);
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
					{composer.workSessionId ? (
						<ComposerRegistration
							focus={focus}
							workSessionId={composer.workSessionId}
							paneId={paneId}
							chatId={options.chatId}
							focusRoot={focusRoot}
						/>
					) : null}
					<FollowPlanApproval />
					<ThreadPaneOpeners>
						<TranscriptProviders
							workSessionId={composer.workSessionId}
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
	const { workSessionId, chatId } = useComposerContext();
	return (
		<ChatPaneOpeners workSessionId={workSessionId} chatId={chatId}>
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

/**
 * Registers the pane's composer with the window's composer domain and keeps
 * its draft, once the runtime shows the pane's chat: a chat's thread loads
 * after a placeholder thread whose composer is thrown away (and emptied)
 * when it does.
 */
function ComposerRegistration({
	chatId,
	...props
}: {
	focus: ComposerFocus;
	workSessionId: string;
	paneId: string;
	/** The chat the pane opened, or null for a draft. */
	chatId: string | null;
	focusRoot: () => void;
}) {
	const showsChat = useAuiState(
		(state) => chatId === null || state.threadListItem.remoteId === chatId,
	);
	return showsChat ? <ShownComposerRegistration {...props} /> : null;
}

function ShownComposerRegistration({
	focus,
	workSessionId,
	paneId,
	focusRoot,
}: {
	focus: ComposerFocus;
	workSessionId: string;
	paneId: string;
	focusRoot: () => void;
}) {
	const aui = useAui();
	const text = useAuiState((state) => state.composer.text);
	// Registering prefills an empty composer with the pane's draft, so it
	// must happen once per mount: a re-run while a send has just emptied the
	// composer (before its draft is cleared) would put the sent text back.
	const latestFocusRoot = useRef(focusRoot);
	latestFocusRoot.current = focusRoot;
	useEffect(
		() =>
			focus.register({
				workSessionId,
				paneId,
				focus: () => latestFocusRoot.current(),
				getText: () => aui.composer.getState().text,
				setText: (next) => aui.composer.setText(next),
			}),
		[aui, focus, paneId, workSessionId],
	);
	useEffect(
		() => focus.reportDraft(workSessionId, paneId, text),
		[focus, paneId, workSessionId, text],
	);
	useAuiEvent("composer.send", () => focus.reportDraft(workSessionId, paneId, ""));
	return null;
}
