import { AssistantRuntimeProvider, useAui, useAuiEvent, useAuiState } from "@assistant-ui/react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { BotIcon, BotMessageSquareIcon } from "lucide-react";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type FC,
	type ReactNode,
} from "react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Chats } from "@kilo-desktop/plugin-core/contracts";
import {
	Panes,
	WorkSessions,
	Workspaces,
	type PaneProps,
	type PaneStatus,
	type WorkspacesState,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { FindScope } from "@kilo-desktop/ui/components/find-bar";
import { ProgressOverlay } from "@kilo-desktop/ui/components/progress-overlay";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";
import { useStableValue } from "@kilo-desktop/ui/hooks/use-stable";

import {
	paneChatId,
	chatPaneObject,
	CHAT_TELEMETRY_EVENTS,
	type ComposerContext,
	type PromptPart as MentionPart,
} from "../contracts";
import { ComposerContextContext, useComposerContext } from "./composer/composer-actions";
import { resolveMentionParts, type MentionSource } from "./composer/mention-codec";
import { useMentionSources } from "./composer/mention-triggers";
import { focusComposerIn, SESSION_ATTRIBUTE, type ComposerFocus } from "./composer-focus";
import { forkChat, type ForkPhase } from "./fork/fork-chat";
import { ForkProvider, type ForkRequest, type ForkValue } from "./fork/fork-context";
import type { CreatedChat } from "./runtime/chat-backend";
import { ChatConnectionProvider } from "./runtime/chat-connection";
import type { ChatServices } from "./runtime/chat-services";
import type { PromptPart } from "./runtime/prompt-options";
import { chatSystemPrompt, sessionFolders, type PromptFolder } from "./runtime/system-prompt";
import { useChatRuntime } from "./runtime/use-chat-runtime";
import { ComposerSelectionProvider, type PromptSelection } from "./selection/composer-selection";
import { prepareForPrompt, useModelSourcesRef } from "./selection/model-source";
import {
	ClientSlashSelectionProvider,
	serverCommandNames,
	useSlashCommands,
} from "./slash-commands/client-slash-commands";
import { ChatPaneOpeners } from "./panes/chat-pane-openers";
import { FollowPlanApproval } from "./plan/follow-plan-approval";
import { ChatReadingProvider, type ChatReading } from "./reading/chat-reading";
import { useTracker } from "./shared/telemetry";
import { Thread } from "./thread/thread";
import { TranscriptProviders, useTranscriptAui } from "./thread/transcript-scope";

/** The agent tab's icon: a speech bubble while the agent waits for the person's answer. */
export const AgentIcon: FC<{ className?: string; status?: PaneStatus }> = ({ className, status }) =>
	status === "attention" ? (
		<BotMessageSquareIcon className={className} />
	) : (
		<BotIcon className={className} />
	);

export interface AgentPaneServices {
	readonly chat: ChatServices;
	readonly focus: ComposerFocus;
	/** The window's query cache: Kilo's agent, model and command catalogs. */
	readonly queries: QueryClient;
	/** The window's Reading Mode (Focus, the reading control, Saved). */
	readonly reading?: ChatReading;
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

/**
 * The agent pane, bound to its window's services: the chat it names (its
 * `object`) or, naming none, a draft whose first send creates a chat in the work session
 * (`WorkSessions.createChat`) and makes it the pane's `object`. A work
 * session can hold several, each its own chat.
 */
export function createAgentPane(services: AgentPaneServices): FC<PaneProps> {
	return (props) => <AgentPane {...props} services={services} />;
}

function AgentPane({
	workSessionId,
	pane,
	workspaceId,
	directory,
	services,
}: PaneProps & { services: AgentPaneServices }) {
	const workSession = useDomainObjectState(
		WorkSessions,
		(state: DomainObjectState<typeof WorkSessions>) =>
			state.workSessions.find((candidate) => candidate.id === workSessionId),
	);
	const workspace = useDomainObjectState(Workspaces, (state: WorkspacesState) =>
		state.workspaces.find((candidate) => candidate.id === workspaceId),
	);
	const chats = useDomainObject(Chats);
	const workSessions = useDomainObject(WorkSessions);
	const panes = useDomainObject(Panes);
	const rootRef = useRef<HTMLDivElement>(null);

	const chatId = paneChatId(pane);
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
	const latest = useLatestRef(context);
	const { mounted, thread } = useMountedChat(chatId);
	// Keyed on the folders' content, not the array, so a re-published
	// workspace with the same folders keeps the composer context.
	const workspaceFolders = useStableValue(
		(workspace?.folders ?? []).map(({ path, isPrimary }) => ({ path, isPrimary })),
		sameFolders,
	);

	const createChat = async (): Promise<CreatedChat> => {
		if (!workSessions) throw new Error("Kilo chats aren't available.");
		const current = latest.current;
		thread.startCreating();
		let chat;
		try {
			chat = await workSessions.methods.createChat({ id: current.workSessionId });
		} catch (error) {
			thread.stopCreating();
			throw error;
		}
		thread.created(chat.id);
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
	};

	const directoryOf = (id: string) => {
		const known = chats?.getState().chats[id]?.directory;
		if (known) return known;
		const current = latest.current;
		return current.workSessionChatIds.includes(id) ? current.workSessionDirectory : null;
	};

	const getSystem = async (id: string) => {
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
	};

	const track = useTracker();
	const [forkPhase, setForkPhase] = useState<ForkPhase | null>(null);
	// Guards a double click, which lands before the phase re-renders.
	const forking = useRef(false);
	const fork = ({ chatId: source, messageId, midTurn }: ForkRequest) => {
		if (forking.current) return;
		forking.current = true;
		void forkChat({
			workSessions,
			panes,
			workSessionId: latest.current.workSessionId,
			chatId: source,
			messageId,
			onPhase: setForkPhase,
			track: (success) => track(CHAT_TELEMETRY_EVENTS.chatForked, { success, midTurn }),
		}).finally(() => {
			forking.current = false;
		});
	};
	const forkValue: ForkValue = { fork, pending: forkPhase !== null };

	const composer: ComposerContext = {
		workSessionId,
		chatId: mounted.chatId,
		directory,
		workspaceId,
		workspaceFolders,
	};

	return (
		<div
			ref={rootRef}
			className="relative flex h-full min-h-0 flex-col"
			data-qa-id="kilo-agent-pane"
			{...{ [SESSION_ATTRIBUTE]: workSessionId }}
		>
			<FindScope
				data-qa-id="kilo-agent-pane-content"
				inert={forkPhase !== null}
				aria-busy={forkPhase !== null}
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
							createChat={createChat}
							directoryOf={directoryOf}
							getSystem={getSystem}
							onChatId={(id) => {
								if (id) thread.show(id);
							}}
							focusRoot={() => focusComposerIn(rootRef.current)}
						>
							<ForkProvider value={forkValue}>
								<ChatReadingProvider
									reading={services.reading}
									workSessionId={workSessionId}
									paneId={pane.id}
									chatId={chatId}
								>
									<Thread />
								</ChatReadingProvider>
							</ForkProvider>
						</ChatThread>
					</ChatConnectionProvider>
				</QueryClientProvider>
			</FindScope>
			{forkPhase ? (
				<ProgressOverlay
					message={forkPhase === "forking" ? "Forking the chat…" : "Opening the chat…"}
					data-qa-id="kilo-fork-progress"
				/>
			) : null}
		</div>
	);
}

type WorkspaceFolder = ComposerContext["workspaceFolders"][number];

function sameFolders(previous: readonly WorkspaceFolder[], next: readonly WorkspaceFolder[]) {
	return (
		previous.length === next.length &&
		previous.every(
			(folder, index) =>
				folder.path === next[index]!.path && folder.isPrimary === next[index]!.isPrimary,
		)
	);
}

interface ThreadReport {
	/** A draft's first send is creating its chat. */
	readonly creating: boolean;
	/** The chat the thread last said it shows. */
	readonly chatId: string | null;
	/** How many times it has said so; tells a report from one made before a remount. */
	readonly reports: number;
}

/**
 * What the pane's thread says about itself, written by its callbacks (the
 * runtime's thread id, a draft's first send) and read during the pane's
 * render through `useSyncExternalStore`, so a render always sees the latest
 * report even when it arrives between renders. A draft's chat is reported
 * created and no longer creating in one change, so no render sees the
 * second without the first.
 */
class ThreadReports {
	#report: ThreadReport = { creating: false, chatId: null, reports: 0 };
	readonly #listeners = new Set<() => void>();

	readonly subscribe = (listener: () => void) => {
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	};

	readonly getSnapshot = () => this.#report;

	startCreating() {
		this.#set({ ...this.#report, creating: true });
	}

	stopCreating() {
		this.#set({ ...this.#report, creating: false });
	}

	created(chatId: string) {
		this.#set({ creating: false, chatId, reports: this.#report.reports + 1 });
	}

	show(chatId: string) {
		this.#set({ ...this.#report, chatId, reports: this.#report.reports + 1 });
	}

	#set(report: ThreadReport) {
		this.#report = report;
		for (const listener of this.#listeners) listener();
	}
}

/**
 * The chat the pane's thread is mounted for, and the generation that keys it.
 * A new `chatId` remounts the thread unless the thread itself already shows
 * it (reported by the runtime or a draft's first send since the last
 * remount) or a draft is creating its chat: the work session may list the
 * new chat before the pane records it, and neither may remount the thread
 * that is sending the first message.
 */
function useMountedChat(chatId: string | null) {
	const [thread] = useState(() => new ThreadReports());
	const report = useSyncExternalStore(thread.subscribe, thread.getSnapshot);
	const [mounted, setMounted] = useState({ generation: 0, chatId, reports: report.reports });
	// A remount shows its chat until the thread reports another.
	const shownChatId = report.reports === mounted.reports ? mounted.chatId : report.chatId;
	if (!report.creating && chatId !== mounted.chatId && chatId !== shownChatId) {
		setMounted({ generation: mounted.generation + 1, chatId, reports: report.reports });
	}
	return { mounted, thread };
}

export interface ChatThreadProps {
	readonly chatId: string | null;
	readonly services: ChatServices;
	readonly focus: ComposerFocus;
	readonly paneId: string;
	readonly composer: ComposerContext;
	readonly createChat: () => Promise<CreatedChat>;
	readonly directoryOf: (chatId: string) => string | null;
	readonly getSystem: (chatId: string) => Promise<string | undefined>;
	readonly onChatId: (chatId: string | undefined) => void;
	readonly onPrompted?: (chatId: string) => void;
	readonly onPromptFailed?: (chatId: string) => void;
	/**
	 * The thread's unmount is final (the New Session page): a first message it
	 * hadn't sent yet goes to main's prompt queue, or else to the work
	 * session's draft. Not for a pane a hidden Activity keeps sending.
	 */
	readonly handOverFirstPrompt?: boolean;
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
	handOverFirstPrompt,
	children,
	...options
}: ChatThreadProps) {
	const selection = useRef<PromptSelection>({});
	const commandNames = useRef<readonly string[]>([]);
	const sources = useLatestRef<readonly MentionSource[]>(useMentionSources());
	const latestComposer = useLatestRef(composer);
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
		...(handOverFirstPrompt
			? {
					firstPromptHandover: {
						keepDraft: (workSessionId: string, text: string) => focus.setDraft(workSessionId, text),
					},
				}
			: {}),
	});
	const aui = useTranscriptAui();
	const getSelection = () => selection.current;
	return (
		<AssistantRuntimeProvider aui={aui} runtime={runtime}>
			<ComposerContextProvider composer={composer}>
				<ComposerSelectionProvider
					draft={options.chatId === null}
					onSelection={(next) => {
						selection.current = next;
					}}
				>
					<ClientSlashSelectionProvider getSelection={getSelection}>
						<CommandNames
							directory={composer.directory}
							onNames={(names) => {
								commandNames.current = names;
							}}
						/>
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
					</ClientSlashSelectionProvider>
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
	const value =
		remoteId && remoteId !== composer.chatId ? { ...composer, chatId: remoteId } : composer;
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

/**
 * Reports the names of Kilo's slash commands for the chat's folder, for
 * prompts to read later: the server's only, as the `/` menu lists them
 * (without those a client command hides), so a client command is never sent.
 */
function CommandNames({
	directory,
	onNames,
}: {
	directory: string | null;
	onNames: (names: readonly string[]) => void;
}) {
	const { commands } = useSlashCommands(directory);
	const commandNames = serverCommandNames(commands);
	// The parent stores the names in a ref read at send time, so reporting them re-renders nothing.
	// react-doctor-disable-next-line react-doctor/no-prop-callback-in-effect
	useLayoutEffect(() => onNames(commandNames), [onNames, commandNames]);
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
	const latestFocusRoot = useLatestRef(focusRoot);
	useEffect(
		() =>
			focus.register({
				workSessionId,
				paneId,
				focus: () => latestFocusRoot.current(),
				getText: () => aui.composer.getState().text,
				setText: (next) => aui.composer.setText(next),
			}),
		[aui, focus, paneId, workSessionId, latestFocusRoot],
	);
	useEffect(
		() => focus.reportDraft(workSessionId, paneId, text),
		[focus, paneId, workSessionId, text],
	);
	useAuiEvent("composer.send", () => focus.reportDraft(workSessionId, paneId, ""));
	return null;
}
