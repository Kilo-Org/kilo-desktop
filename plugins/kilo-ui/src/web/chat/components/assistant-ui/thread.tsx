"use client";

import {
	ComposerAddAttachment,
	ComposerAttachments,
	UserMessageAttachments,
} from "./attachment.js";
import { ComposerDraftFooter } from "./composer-draft-footer.js";
import { ComposerFooter } from "./composer-footer.js";
import { ComposerTriggers } from "./composer-triggers.js";
import { ConversationMapAui } from "./elements/conversation-map.aui.js";
import { DraftWelcomeHeadline } from "./draft-welcome-headline.js";
import { ThreadFollowupSuggestions } from "./follow-up-suggestions.js";
import { KiloAgentSelector } from "./kilo-agent-selector.js";
import { KiloModelSelector } from "./kilo-model-selector.js";
import { KiloDirectiveText } from "./kilo-directive-text.js";
import { KiloLexicalComposerInput } from "./kilo-lexical-composer-input.js";
import { MarkdownText } from "./markdown-text.js";
import { MessageCopyButton } from "./message-copy-button.js";
import { Reasoning } from "./reasoning.js";
import { TooltipIconButton } from "./tooltip-icon-button.js";
import { ActivityGroup, ActivitySubgroup } from "../tools/activity-group.js";
import { createActivityGroupBy, createTurnWorkGroupBy } from "../tools/activity-grouping.js";
import { OpenCodeComposerInteraction } from "../tools/opencode-composer-interaction.js";
import { OPENCODE_SNAPSHOT_PROGRESS_PART } from "../tools/opencode-data-part.js";
import { FallbackTool } from "../tools/opencode-tools.js";
import { activityKindFromGroupKey } from "../tools/tool-categories.js";
import { getPlanProjectionForMessage } from "../../plan/index.js";
import { useApprovePlan } from "../../plan/use-approve-plan.js";
import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
} from "@anaconda-agentic-desktop/ui/components/avatar";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@anaconda-agentic-desktop/ui/components/collapsible";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";
import {
	ActionBarMorePrimitive,
	ActionBarPrimitive,
	AuiIf,
	type AssistantState,
	BranchPickerPrimitive,
	ComposerPrimitive,
	ErrorPrimitive,
	MessagePrimitive,
	QueueItemPrimitive,
	SuggestionPrimitive,
	ThreadPrimitive,
	type QueueItemState,
	type ToolCallMessagePartComponent,
	useAui,
	useAuiEvent,
	useAuiState,
	useThreadViewport,
} from "@assistant-ui/react";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	CheckCircle2Icon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CornerDownLeftIcon,
	DownloadIcon,
	FileTextIcon,
	Loader2Icon,
	MicIcon,
	MoreHorizontalIcon,
	SquareIcon,
	Trash2Icon,
} from "lucide-react";
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentType,
	type FC,
	type FormEvent,
	type KeyboardEvent,
	type PropsWithChildren,
} from "react";

import {
	displayChatError,
	isKiloSignInError,
	offerKiloSignIn,
} from "../../../account/kilo-auth.js";
import { useKiloAuth } from "../../../account/KiloAuthContext.js";
import { useChatAgentSelection } from "../../agent-selection/ChatAgentSelectionContext.js";
import {
	cycleCatalogAgent,
	OPTIMISTIC_AGENT_CATALOG,
} from "../../agent-selection/agent-catalog.js";
import { useChatConnection } from "../../connection/ChatConnectionContext.js";
import {
	isLocalModelLoadingStatus,
	LOCAL_MODEL_LOADING_TITLE,
} from "../../local-model-loading-copy.js";
import { useChatModelSelection } from "../../model-selection/ChatModelSelectionContext.js";
import { isKiloGatewayProvider } from "../../model-selection/model-catalog.js";
import { usePlanThreadProjection } from "../../plan/use-plan-thread-projection.js";
import { useOptionalOpenCodeRuntimeExtras } from "../../runtime/use-optional-opencode-runtime-extras.js";
import { usePendingKiloSuggestion } from "../../suggestions/KiloSuggestionContext.js";
import {
	assistantWorkingIndicatorMode,
	isComposerPromptBusy,
	messageHasInFlightActivity,
} from "../../suggestions/kilo-suggestion-logic.js";
import { useLocalInferenceStatus } from "../../use-local-inference-status.js";
import { ANACONDA_LOCAL_PROVIDER_ID } from "../../../providers/provider-ids.js";
import { retryFailedPrompt } from "./retry-failed-prompt.js";

import "./assistant-working-indicator.css";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; `ToolFallback` overrides unknown tool
 * renders. Named toolkit renders take precedence over `ToolFallback`.
 */
export type ThreadComponents = {
	AssistantMessage?: ComponentType | undefined;
	Welcome?: ComponentType | undefined;
	ToolFallback?: ToolCallMessagePartComponent | undefined;
};

export type ThreadProps = {
	components?: ThreadComponents | undefined;
};

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext = createContext<ThreadComponents>(EMPTY_COMPONENTS);

const ThreadComposerSlot: FC = () => {
	return (
		<div className="flex flex-col gap-3">
			<OpenCodeComposerInteraction fallback={<Composer />} />
		</div>
	);
};

// Empty threads stay in draft layout (centered composer). Require status
// "new" too — after lazy session init the list item flips to regular before
// messages project, and treating that as draft docks→centers→docks again.
export const isDraftView = (s: AssistantState) =>
	s.thread.messages.length === 0 && s.threadListItem.status === "new";

export const Thread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS }) => {
	const isDraft = useAuiState(isDraftView);

	return (
		<ThreadComponentsContext.Provider value={components}>
			<ThreadRoot isDraft={isDraft} />
		</ThreadComponentsContext.Provider>
	);
};

const ComposerDockMask: FC = () => {
	return (
		<>
			<div
				aria-hidden
				className="bg-background pointer-events-none absolute -inset-x-4 top-full h-4"
			/>
			<div aria-hidden className="composer-corner-fill composer-corner-fill-bl" />
			<div aria-hidden className="composer-corner-fill composer-corner-fill-br" />
		</>
	);
};

const ThreadComposerBlock: FC<{ isDraft: boolean }> = ({ isDraft }) => {
	const { Welcome = DraftWelcomeHeadline } = useContext(ThreadComponentsContext);

	return (
		<div className="relative flex w-full flex-col">
			{isDraft ? <Welcome /> : null}
			<div className="flex w-full flex-col">
				<ThreadComposerSlot />
				{isDraft ? <ComposerDraftFooter /> : null}
			</div>
		</div>
	);
};

const ThreadRoot: FC<{ isDraft: boolean }> = ({ isDraft }) => {
	return (
		<ThreadPrimitive.Root
			className="aui-root aui-thread-root bg-background @container flex h-full flex-col [--composer-bg:var(--color-card)]"
			style={{
				["--thread-max-width" as string]: "48rem",
				["--composer-radius" as string]: "1rem",
				["--composer-padding" as string]: "8px",
			}}
		>
			<ThreadPrimitive.Viewport
				turnAnchor="bottom"
				autoScroll
				scrollToBottomOnRunStart={false}
				data-slot="aui_thread-viewport"
				className={cn(
					"relative flex flex-1 flex-col items-center overflow-x-hidden overflow-y-auto scroll-smooth",
					!isDraft && "[scrollbar-gutter:stable_both-edges]",
				)}
			>
				<ScrollToBottomOnSend />
				<div
					aria-hidden
					className="from-background pointer-events-none sticky top-0 z-10 -mb-6 h-6 w-full shrink-0 bg-linear-to-b to-transparent"
				/>
				{isDraft ? null : <ConversationMapAui />}
				<div
					data-slot="aui_thread-column"
					className={cn(
						"mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col pt-4",
						isDraft ? "justify-center px-4" : "px-1",
					)}
				>
					<div
						data-slot="aui_message-group"
						className={cn("flex flex-col gap-y-4 empty:hidden", isDraft ? "mb-10" : "mb-16")}
					>
						<ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
					</div>

					<ThreadPrimitive.ViewportFooter
						className={cn(
							/* Transparent so sticky glass can blur scrolled messages behind the shell. */
							"aui-thread-viewport-footer relative flex flex-col gap-4 overflow-visible",
							isDraft ? "pb-4" : "sticky bottom-0 mt-auto rounded-t-(--composer-radius) pb-1.5",
						)}
					>
						<ThreadScrollToBottom />
						<ThreadFollowupSuggestions />
						<div className="flex flex-col gap-1.5">
							<div className="relative">
								{!isDraft ? <ComposerDockMask /> : null}
								<ThreadComposerBlock isDraft={isDraft} />
							</div>
							{!isDraft ? <ComposerFooter /> : null}
						</div>
						{isDraft ? <ThreadSuggestions /> : null}
					</ThreadPrimitive.ViewportFooter>
				</div>
			</ThreadPrimitive.Viewport>
		</ThreadPrimitive.Root>
	);
};

const ThreadMessage: FC = () => {
	const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
		useContext(ThreadComponentsContext);
	const role = useAuiState((s) => s.message.role);

	if (role === "user") return <UserMessage />;
	return <AssistantMessageComponent />;
};

// The current turn and its preceding response stay measurable so the intrinsic
// fallback used for older messages cannot distort their visual grouping.
const useVirtualizeMessage = () =>
	useAuiState((s) => s.message.index < s.thread.messages.length - 3);

const ThreadScrollToBottom: FC = () => {
	return (
		<ThreadPrimitive.ScrollToBottom
			render={
				<TooltipIconButton
					tooltip="Scroll to bottom"
					variant="outline"
					className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-accent absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
				/>
			}
		>
			<ArrowDownIcon />
		</ThreadPrimitive.ScrollToBottom>
	);
};

// `composer.send` fires only for user-initiated sends; queue auto-dispatch
// bypasses the composer, so a drained queue item never yanks the viewport
// away from someone reading history. Long distances jump instantly instead
// of gliding: virtualized messages re-measure and rasterize as a scroll
// crosses them (`contain-intrinsic-size: auto 200px`), which reads as jumps
// and flashes. The bottom of the list is always rendered, and short glides
// never cross unrendered content.
const SMOOTH_SCROLL_VIEWPORT_HEIGHTS = 1.5;

const ScrollToBottomOnSend: FC = () => {
	const scrollToBottom = useThreadViewport((s) => s.scrollToBottom);
	const viewport = useThreadViewport((s) => s.element.viewport);
	useAuiEvent("composer.send", () => {
		const distance = viewport
			? viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
			: 0;
		const behavior =
			viewport && distance > viewport.clientHeight * SMOOTH_SCROLL_VIEWPORT_HEIGHTS
				? "instant"
				: "smooth";
		scrollToBottom({ behavior });
	});
	return null;
};

const ThreadSuggestions: FC = () => {
	const isComposerEmpty = useAuiState((s) => s.composer.isEmpty);

	return (
		<div
			aria-hidden={!isComposerEmpty}
			className={cn(
				"aui-thread-welcome-suggestions flex w-full flex-wrap items-center justify-center gap-2 px-4",
				!isComposerEmpty && "invisible",
			)}
		>
			<ThreadPrimitive.Suggestions>{() => <ThreadSuggestionItem />}</ThreadPrimitive.Suggestions>
		</div>
	);
};

const ThreadSuggestionItem: FC = () => {
	return (
		<div className="aui-thread-welcome-suggestion-display fade-in slide-in-from-bottom-2 animate-in fill-mode-both duration-200">
			<SuggestionPrimitive.Trigger
				send
				render={
					<Button
						variant="ghost"
						className="aui-thread-welcome-suggestion text-foreground hover:bg-muted border-border/60 h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap transition-colors"
					/>
				}
			>
				<SuggestionPrimitive.Title className="aui-thread-welcome-suggestion-text-1" />
				<SuggestionPrimitive.Description className="aui-thread-welcome-suggestion-text-2 empty:hidden" />
			</SuggestionPrimitive.Trigger>
		</div>
	);
};

type QueueItemAttachmentPreview = {
	readonly name: string;
	readonly src?: string;
};

type QueueItemWithAttachmentPreview = QueueItemState & {
	readonly attachmentPreview?: QueueItemAttachmentPreview;
};

const QueueAttachmentPreview: FC<{ attachment: QueueItemAttachmentPreview }> = ({ attachment }) => {
	return (
		<div
			className="border-border/60 bg-muted flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border"
			data-qa-id="kilo-composer-queue-attachment"
		>
			{attachment.src ? (
				<img
					src={attachment.src}
					alt={`${attachment.name} attachment preview`}
					className="size-full object-cover"
				/>
			) : (
				<FileTextIcon
					role="img"
					aria-label={`${attachment.name} attachment`}
					className="text-muted-foreground size-3.5"
				/>
			)}
		</div>
	);
};

const ComposerQueue: FC<{ steerOnEnter: boolean }> = ({ steerOnEnter }) => {
	const queueLength = useAuiState((s) => s.composer.queue.length);
	const [collapsed, setCollapsed] = useState(false);

	if (queueLength === 0) return null;

	return (
		<div
			className="border-border/60 chat-composer-glass chat-composer-surface overflow-hidden rounded-xl border shadow-[0_8px_24px_-20px_rgba(0,0,0,0.7)]"
			data-qa-id="kilo-composer-queue"
		>
			<button
				type="button"
				className={cn(
					"text-muted-foreground hover:bg-muted/35 focus-visible:ring-ring/50 flex h-8 w-full items-center justify-between px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2",
					!collapsed && "border-border/40 border-b",
				)}
				aria-expanded={!collapsed}
				aria-controls="kilo-composer-queue-items"
				onClick={() => setCollapsed((value) => !value)}
				data-qa-id="kilo-composer-queue-toggle"
			>
				<span>{queueLength} queued</span>
				<ChevronDownIcon
					className={cn("size-3.5 transition-transform duration-150", collapsed && "-rotate-90")}
				/>
			</button>
			{!collapsed ? (
				<div id="kilo-composer-queue-items" className="flex max-h-36 flex-col overflow-y-auto p-1">
					<ComposerPrimitive.Queue>
						{({ queueItem }) => <QueueItemRow queueItem={queueItem} showEnterHint={steerOnEnter} />}
					</ComposerPrimitive.Queue>
				</div>
			) : null}
		</div>
	);
};

const QueueItemRow: FC<{ queueItem: QueueItemState; showEnterHint: boolean }> = ({
	queueItem,
	showEnterHint,
}) => {
	const isFirst = useAuiState((s) => s.composer.queue[0]?.id === queueItem.id);
	const attachmentPreview = (queueItem as QueueItemWithAttachmentPreview).attachmentPreview;

	return (
		<div
			className="group hover:bg-muted/45 after:bg-border/35 relative flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-md pr-[3px] pl-2 transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-px after:content-[''] last:after:hidden"
			data-qa-id="kilo-composer-queue-item"
			data-queue-item-id={queueItem.id}
		>
			{attachmentPreview ? <QueueAttachmentPreview attachment={attachmentPreview} /> : null}
			<QueueItemPrimitive.Text className="text-foreground/90 min-w-0 flex-1 truncate text-sm" />
			<QueueItemPrimitive.Steer
				render={
					<Button
						type="button"
						size="xs"
						variant="ghost"
						className="text-muted-foreground hover:text-foreground h-6 px-2 text-[11px] opacity-65 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
						data-qa-id="kilo-composer-queue-send-now"
					/>
				}
			>
				{showEnterHint && isFirst ? <CornerDownLeftIcon aria-hidden className="size-3" /> : null}
				Send now
			</QueueItemPrimitive.Steer>
			<QueueItemPrimitive.Remove
				render={
					<TooltipIconButton
						tooltip="Delete queued message"
						side="bottom"
						type="button"
						variant="ghost"
						size="icon-xs"
						className="text-muted-foreground hover:text-destructive-foreground size-6 opacity-65 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
						aria-label="Delete queued message"
						data-qa-id="kilo-composer-queue-delete"
					/>
				}
			>
				<Trash2Icon className="size-3" />
			</QueueItemPrimitive.Remove>
		</div>
	);
};

const Composer: FC = () => {
	const aui = useAui();
	const isDraft = useAuiState(isDraftView);
	const activeThreadId = useAuiState((s) => s.threadListItem.id);
	const isComposerEmpty = useAuiState((s) => s.composer.isEmpty);
	const hasMessageQueue = useAuiState((s) => s.thread.capabilities.queue);
	const { isPending, connectionPromise } = useChatConnection();
	const [isConnecting, setIsConnecting] = useState(false);
	const isConnectingRef = useRef(false);
	const inputRef = useRef<HTMLDivElement>(null);
	const { refine, submitting, canReply } = useApprovePlan();
	const { agent, setAgent, catalog, isCatalogPending, isCatalogError } = useChatAgentSelection();
	const pendingSuggestion = usePendingKiloSuggestion();
	const inferenceStatus = useLocalInferenceStatus();
	const { model } = useChatModelSelection();
	const isLoadingModel =
		model?.providerID === ANACONDA_LOCAL_PROVIDER_ID &&
		isLocalModelLoadingStatus(inferenceStatus) &&
		inferenceStatus.modelId === model.modelID;

	const showPlanFollowupActions = canReply && !isConnecting && !isPending && !isLoadingModel;

	const sendFollowup = () => {
		if (isLoadingModel || isComposerEmpty) return;
		aui.composer.send(hasMessageQueue ? { startRun: false } : undefined);
	};

	const lastPaneFocusRef = useRef<HTMLElement | null>(null);
	const wasConnectingRef = useRef(isConnecting);

	useEffect(() => {
		const onFocusIn = (event: FocusEvent) => {
			const target = event.target;
			if (!(target instanceof HTMLElement)) return;
			if (target.closest('[data-qa-id="kilo-chat-pane-canvas"]')) {
				lastPaneFocusRef.current = target;
			} else if (!target.closest(".aui-lexical-editor")) {
				lastPaneFocusRef.current = null;
			}
		};
		document.addEventListener("focusin", onFocusIn);
		return () => document.removeEventListener("focusin", onFocusIn);
	}, []);

	useEffect(() => {
		return aui.on("thread.runStart", () => {
			const restore = lastPaneFocusRef.current;
			if (!restore?.isConnected) return;
			queueMicrotask(() => restore.focus({ preventScroll: true }));
		});
	}, [aui]);

	useEffect(() => {
		const connectingJustEnded = wasConnectingRef.current && !isConnecting;
		wasConnectingRef.current = isConnecting;
		const restore = lastPaneFocusRef.current;
		if (connectingJustEnded && restore?.isConnected) {
			restore.focus({ preventScroll: true });
			return;
		}
		if (restore?.isConnected) return;
		const activeElement = document.activeElement;
		const paneOwnsFocus = activeElement?.closest('[data-qa-id="kilo-chat-pane-canvas"]');
		if (!isDraft || isConnecting || paneOwnsFocus) return;
		inputRef.current
			?.querySelector<HTMLElement>("[contenteditable]")
			?.focus({ preventScroll: true });
	}, [activeThreadId, isConnecting, isDraft]);

	const sendWhenConnected = () => {
		if (isConnectingRef.current || isLoadingModel) {
			return;
		}
		const composer = aui.composer.getState();
		if (composer.isEmpty) {
			return;
		}

		isConnectingRef.current = true;
		setIsConnecting(true);
		void (async () => {
			try {
				await connectionPromise;
				aui.composer.send();
			} catch {
				// Connection errors surface via the ChatPage banner.
			} finally {
				isConnectingRef.current = false;
				setIsConnecting(false);
			}
		})();
	};

	const handlePlanRefineSubmit = () => {
		if (isComposerEmpty) return;
		refine();
	};

	const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
		if (isLoadingModel) {
			event.preventDefault();
			return;
		}
		// Plan follow-up keeps the thread running, so ComposerInput ignores Enter.
		// Route submit to Refine instead of composer.send().
		if (showPlanFollowupActions) {
			event.preventDefault();
			handlePlanRefineSubmit();
			return;
		}
		// Suggest keeps thread.isRunning true, so ComposerPrimitive.Send is
		// disabled — send through the runtime instead, matching VS Code.
		if (pendingSuggestion) {
			event.preventDefault();
			sendFollowup();
			return;
		}
		// When Kilo is still starting, wait before composer.send() so the draft
		// stays visible and the send button can show a spinner. preventDefault
		// skips ComposerPrimitive.Root's built-in send handler (Enter key).
		if (!isPending && !isConnecting) {
			return;
		}
		event.preventDefault();
		sendWhenConnected();
	};

	const handleInputKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		if (
			event.key === "Tab" &&
			event.shiftKey &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			!event.nativeEvent.isComposing &&
			!isCatalogError
		) {
			event.preventDefault();
			const next = cycleCatalogAgent(
				catalog ?? (isCatalogPending ? OPTIMISTIC_AGENT_CATALOG : undefined),
				agent,
				1,
			);
			if (next && next !== agent) {
				setAgent(next);
			}
			return;
		}

		if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
		if (isLoadingModel) {
			event.preventDefault();
			return;
		}
		if (event.defaultPrevented && hasMessageQueue) return;
		if (showPlanFollowupActions) {
			// ComposerInput returns early while isRunning — intercept before that.
			event.preventDefault();
			handlePlanRefineSubmit();
			return;
		}
		if (pendingSuggestion) {
			event.preventDefault();
			sendFollowup();
			return;
		}
		// Queue only when a run was already in flight and Lexical skipped send.
		if (aui.thread.getState().isRunning && hasMessageQueue && !isComposerEmpty) {
			event.preventDefault();
			aui.composer.send();
		}
	};

	// Mirrors SteerQueueOnEnterPlugin's gating (submitMode "enter", editable
	// input) so the Enter hint only shows when Enter would actually steer.
	const steerQueueOnEnter = hasMessageQueue && isComposerEmpty && !isConnecting && !isLoadingModel;

	return (
		<ComposerPrimitive.Unstable_TriggerPopoverRoot>
			<ComposerPrimitive.Root
				className="aui-composer-root relative flex w-full flex-col gap-2"
				onSubmit={handleSubmit}
			>
				<ComposerQueue steerOnEnter={steerQueueOnEnter} />
				<ComposerPrimitive.AttachmentDropzone
					render={
						<div
							data-slot="aui_composer-shell"
							className={cn(
								"border-border chat-composer-surface data-[dragging=true]:border-ring flex w-full flex-col gap-2 rounded-(--composer-radius) border px-(--composer-padding) pt-2 pb-(--composer-padding) transition-[border-color,outline-color,box-shadow] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]",
								isDraft
									? "relative z-10 bg-(--composer-bg) dark:border-border focus-within:border-border dark:focus-within:border-muted-foreground/30"
									: "relative z-10 chat-composer-glass shadow-[0_12px_28px_-18px_rgba(0,0,0,0.40)] dark:shadow-none",
							)}
						/>
					}
				>
					<ComposerAttachments />
					<KiloLexicalComposerInput
						ref={inputRef}
						disabled={isConnecting}
						cancelOnEscape={!pendingSuggestion}
						submitMode={isLoadingModel ? "none" : "enter"}
						onKeyDown={handleInputKeyDown}
					/>
					<ComposerTriggers />
					<ComposerAction
						isConnecting={isConnecting}
						isLoadingModel={isLoadingModel}
						isConnectionPending={isPending}
						onSendWhenConnected={sendWhenConnected}
						onSendFollowup={sendFollowup}
						modelSelectorSide={isDraft ? "bottom" : "top"}
						showPlanFollowupActions={showPlanFollowupActions}
						planActionPending={submitting}
						onRefine={refine}
					/>
				</ComposerPrimitive.AttachmentDropzone>
			</ComposerPrimitive.Root>
		</ComposerPrimitive.Unstable_TriggerPopoverRoot>
	);
};

const ComposerAction: FC<{
	isConnecting: boolean;
	isLoadingModel: boolean;
	isConnectionPending: boolean;
	onSendWhenConnected: () => void;
	onSendFollowup: () => void;
	modelSelectorSide: "top" | "bottom";
	showPlanFollowupActions: boolean;
	planActionPending: boolean;
	onRefine: () => void;
}> = ({
	isConnecting,
	isLoadingModel,
	isConnectionPending,
	onSendWhenConnected,
	onSendFollowup,
	modelSelectorSide,
	showPlanFollowupActions,
	planActionPending,
	onRefine,
}) => {
	const isRunning = useAuiState((s) => s.thread.isRunning);
	const canSend = useAuiState((s) => s.composer.canSend);
	const isComposerEmpty = useAuiState((s) => s.composer.isEmpty);
	const canQueue = useAuiState((s) => s.thread.capabilities.queue);
	const pendingSuggestion = usePendingKiloSuggestion();
	const isPromptBusy = isComposerPromptBusy(isRunning, pendingSuggestion);
	const isSendLocked = isConnecting || isLoadingModel;
	const lockLabel = isConnecting ? "Connecting to Kilo" : LOCAL_MODEL_LOADING_TITLE;

	return (
		<div className="aui-composer-action-wrapper relative flex items-center justify-between">
			<div className="flex min-w-0 items-center gap-1">
				<ComposerAddAttachment />
				<KiloAgentSelector />
			</div>
			<div className="flex items-center gap-1.5">
				<KiloModelSelector side={modelSelectorSide} />
				<AuiIf condition={(s) => s.thread.capabilities.dictation}>
					<AuiIf condition={(s) => s.composer.dictation == null}>
						<ComposerPrimitive.Dictate
							render={
								<TooltipIconButton
									tooltip="Voice input"
									side="bottom"
									type="button"
									variant="ghost"
									size="icon"
									className="aui-composer-dictate size-7 rounded-full"
									aria-label="Start voice input"
								/>
							}
						>
							<MicIcon className="aui-composer-dictate-icon size-4" />
						</ComposerPrimitive.Dictate>
					</AuiIf>
					<AuiIf condition={(s) => s.composer.dictation != null}>
						<ComposerPrimitive.StopDictation
							render={
								<TooltipIconButton
									tooltip="Stop dictation"
									side="bottom"
									type="button"
									variant="ghost"
									size="icon"
									className="aui-composer-stop-dictation text-destructive-foreground size-7 rounded-full"
									aria-label="Stop voice input"
								/>
							}
						>
							<SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
						</ComposerPrimitive.StopDictation>
					</AuiIf>
				</AuiIf>
				{isSendLocked ? (
					<TooltipIconButton
						tooltip={lockLabel}
						side="bottom"
						type="button"
						variant="default"
						size="icon"
						disabled
						className={cn(
							"size-7 rounded-full",
							isConnecting ? "aui-composer-connecting" : "aui-composer-loading-model",
						)}
						aria-label={lockLabel}
						data-qa-id={isConnecting ? "kilo-composer-connecting" : "kilo-composer-loading-model"}
					>
						<Loader2Icon
							className={cn(
								"size-4.5 animate-spin",
								isConnecting ? "aui-composer-connecting-icon" : "aui-composer-loading-model-icon",
							)}
						/>
					</TooltipIconButton>
				) : null}
				{!isSendLocked && !isPromptBusy && isConnectionPending ? (
					<TooltipIconButton
						tooltip="Send message"
						side="bottom"
						type="button"
						variant="default"
						size="icon"
						disabled={!canSend}
						className="aui-composer-send size-7 rounded-full"
						aria-label="Send message"
						data-qa-id="kilo-composer-send-when-connected"
						onClick={onSendWhenConnected}
					>
						<ArrowUpIcon className="aui-composer-send-icon size-4.5" />
					</TooltipIconButton>
				) : null}
				{showPlanFollowupActions ? (
					<Button
						type="button"
						size="sm"
						className="h-7 rounded-full px-3"
						disabled={isComposerEmpty || planActionPending}
						data-qa-id="kilo-composer-refine"
						aria-label="Refine plan"
						onClick={() => onRefine()}
					>
						{planActionPending ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
						Refine
					</Button>
				) : null}
				{!showPlanFollowupActions && !isSendLocked && !isPromptBusy && !isConnectionPending ? (
					pendingSuggestion ? (
						<TooltipIconButton
							tooltip="Send message"
							side="bottom"
							type="button"
							variant="default"
							size="icon"
							disabled={!canSend}
							className="aui-composer-send size-7 rounded-full"
							aria-label="Send message"
							data-qa-id="kilo-composer-send"
							onClick={onSendFollowup}
						>
							<ArrowUpIcon className="aui-composer-send-icon size-4.5" />
						</TooltipIconButton>
					) : (
						<ComposerPrimitive.Send
							render={
								<TooltipIconButton
									tooltip="Send message"
									side="bottom"
									type="button"
									variant="default"
									size="icon"
									className="aui-composer-send size-7 rounded-full"
									aria-label="Send message"
									data-qa-id="kilo-composer-send"
								/>
							}
						>
							<ArrowUpIcon className="aui-composer-send-icon size-4.5" />
						</ComposerPrimitive.Send>
					)
				) : null}
				{!showPlanFollowupActions && !isSendLocked && isPromptBusy ? (
					<>
						{canQueue && !isComposerEmpty ? (
							<ComposerPrimitive.Send
								render={
									<Button
										type="button"
										variant="default"
										size="sm"
										className="h-7 rounded-full px-3"
										aria-label="Add message to queue"
										data-qa-id="kilo-composer-queue-submit"
									/>
								}
							>
								Queue
							</ComposerPrimitive.Send>
						) : null}
						<ComposerPrimitive.Cancel
							render={
								<TooltipIconButton
									tooltip="Stop generating"
									type="button"
									variant={canQueue && !isComposerEmpty ? "outline" : "default"}
									size="icon"
									className="aui-composer-cancel size-7 rounded-full"
									aria-label="Stop generating"
								/>
							}
						>
							<SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
						</ComposerPrimitive.Cancel>
					</>
				) : null}
			</div>
		</div>
	);
};

const CONSIDERING_NEXT_STEPS = "Considering next steps";
const SNAPSHOT_PROGRESS_STATUS = "Initializing snapshot...";
const SNAPSHOT_INDICATOR_DELAY_MS = 200;
const CONSIDERING_INDICATOR_DELAY_MS = 750;
const WORKING_INDICATOR_PIXEL_DELAYS = Array.from({ length: 9 }, (_, index) => {
	const row = Math.floor(index / 3);
	return ((index % 3) + Math.abs(row - 1)) * 90;
});

function formatElapsedTime(deciseconds: number) {
	const seconds = deciseconds / 10;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

function formatTurnDuration(durationMs: number) {
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

function elapsedDecisecondsSince(startedAt: number) {
	return Math.max(0, Math.floor((Date.now() - startedAt) / 100));
}

const AssistantWorkingIndicator: FC = () => {
	const turnStartedAt = useAuiState((s) => {
		for (let index = s.message.index - 1; index >= 0; index--) {
			const message = s.thread.messages[index];
			if (message?.role === "user") return message.createdAt.getTime();
		}
		return s.message.createdAt.getTime();
	});
	// kilo-vscode parity: a trailing synthetic snapshot-progress part drives the
	// status line instead of rendering as chat text.
	const label = useAuiState((s) => {
		const last = s.message.parts.at(-1);
		return last?.type === "data" && last.name === OPENCODE_SNAPSHOT_PROGRESS_PART
			? SNAPSHOT_PROGRESS_STATUS
			: CONSIDERING_NEXT_STEPS;
	});
	const [visibleLabel, setVisibleLabel] = useState<string | null>(null);
	const [elapsedDeciseconds, setElapsedDeciseconds] = useState(() =>
		elapsedDecisecondsSince(turnStartedAt),
	);

	useEffect(() => {
		const delay =
			label === CONSIDERING_NEXT_STEPS
				? CONSIDERING_INDICATOR_DELAY_MS
				: SNAPSHOT_INDICATOR_DELAY_MS;
		const timeoutId = window.setTimeout(() => setVisibleLabel(label), delay);
		const updateElapsedTime = () => setElapsedDeciseconds(elapsedDecisecondsSince(turnStartedAt));
		updateElapsedTime();
		const intervalId = window.setInterval(updateElapsedTime, 100);
		return () => {
			window.clearTimeout(timeoutId);
			window.clearInterval(intervalId);
		};
	}, [label, turnStartedAt]);

	if (visibleLabel !== label) return null;

	return (
		<div
			data-slot="aui_assistant-message-indicator"
			className="text-muted-foreground flex w-fit items-center gap-2 py-1 text-sm [&:not(:first-child)]:mt-3"
			role="status"
			aria-label={label}
		>
			<AvatarGroup aria-hidden className="-space-x-1">
				<Avatar className="size-6.5">
					<AvatarFallback className="border-2 border-transparent">
						<span className="grid grid-cols-[repeat(3,3px)] gap-[2.5px]">
							{WORKING_INDICATOR_PIXEL_DELAYS.map((delay, index) => (
								<span
									key={index}
									className="assistant-working-pixel size-[3px] rounded-[1px] bg-current"
									style={{ animationDelay: `${delay}ms` }}
								/>
							))}
						</span>
					</AvatarFallback>
				</Avatar>
			</AvatarGroup>
			<span aria-hidden className="relative inline-block font-normal">
				{label}
				<span className="shimmer shimmer-color-foreground pointer-events-none absolute top-0 left-0 motion-reduce:animate-none">
					{label}
				</span>
			</span>
			{label === CONSIDERING_NEXT_STEPS ? null : (
				<span aria-hidden className="font-mono text-xs tabular-nums opacity-60">
					{formatElapsedTime(elapsedDeciseconds)}
				</span>
			)}
		</div>
	);
};

const WorkingTimer: FC<{ startedAt: number }> = ({ startedAt }) => {
	const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);

	useEffect(() => {
		const update = () => setElapsed(Math.max(0, Date.now() - startedAt));
		update();
		const intervalId = window.setInterval(update, 1_000);
		return () => window.clearInterval(intervalId);
	}, [startedAt]);

	return <span className="tabular-nums">{formatTurnDuration(elapsed)}</span>;
};

const TurnWorkHeader: FC<{ startedAt: number }> = ({ startedAt }) => (
	<div
		className="text-muted-foreground border-border/60 mb-2 flex w-full items-center border-b pt-2 pb-2 text-xs"
		role="status"
		data-qa-id="kilo-turn-working"
	>
		<span>
			Working for <WorkingTimer startedAt={startedAt} />
		</span>
	</div>
);

const TurnWorkDisclosure: FC<
	PropsWithChildren<{ animateCollapse: boolean; duration: string | null; interrupted: boolean }>
> = ({ animateCollapse, duration, interrupted, children }) => {
	const [open, setOpen] = useState(animateCollapse);
	useEffect(() => {
		if (!animateCollapse) return;
		const frameId = window.requestAnimationFrame(() => setOpen(false));
		return () => window.cancelAnimationFrame(frameId);
	}, [animateCollapse]);
	const label = interrupted
		? duration
			? `You stopped after ${duration}`
			: "You stopped this response"
		: duration
			? `Worked for ${duration}`
			: "Worked";
	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			className="mb-3 w-full pt-1"
			data-qa-id="kilo-turn-work"
		>
			<CollapsibleTrigger
				className="text-muted-foreground hover:text-foreground border-border/60 flex w-full items-center gap-1 border-b pt-1 pb-3 text-xs transition-colors"
				data-qa-id="kilo-turn-work-toggle"
			>
				<span>{label}</span>
				{open ? (
					<ChevronDownIcon aria-hidden className="size-3.5" />
				) : (
					<ChevronRightIcon aria-hidden className="size-3.5" />
				)}
			</CollapsibleTrigger>
			<CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none">
				<div className="pt-2 [&>[data-slot=activity-group]:last-child]:mb-0">{children}</div>
			</CollapsibleContent>
		</Collapsible>
	);
};

const MessageError: FC = () => {
	return (
		<MessagePrimitive.Error>
			<KiloMessageErrorBanner />
		</MessagePrimitive.Error>
	);
};

function messageErrorText(status: { type?: string; reason?: string; error?: unknown } | undefined) {
	if (status?.type !== "incomplete" || status.reason !== "error") return undefined;
	const error = status.error;
	if (typeof error === "string") return error;
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return error === undefined ? undefined : String(error);
}

const KiloMessageErrorBanner: FC = () => {
	const auth = useKiloAuth();
	const aui = useAui();
	const extras = useOptionalOpenCodeRuntimeExtras();
	const { model } = useChatModelSelection();
	const errorText = useAuiState((s) => messageErrorText(s.message.status));
	const isKiloModel = model !== undefined && isKiloGatewayProvider({ id: model.providerID });
	const offerSignIn = offerKiloSignIn(auth, isKiloModel);
	const signedIn = auth.authenticated === true && isKiloSignInError(errorText);
	const signingIn = auth.deviceAuth.status === "initiating" || auth.deviceAuth.status === "waiting";
	const retrying = useRef(false);

	if (signedIn) {
		return (
			<div
				role="status"
				className="border-border bg-background mt-2 flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
				data-qa-id="kilo-message-error-signed-in"
			>
				<span className="flex min-w-0 items-center gap-2">
					<CheckCircle2Icon className="text-primary size-4 shrink-0" />
					<span>You&rsquo;re signed in to Kilo.</span>
				</span>
				<Button
					type="button"
					size="sm"
					onClick={() => {
						if (retrying.current) return;
						retrying.current = true;
						const thread = aui.thread();
						void retryFailedPrompt({
							messages: thread.getState().messages,
							assistantId: aui.message().getState().id,
							...(extras ? { revert: extras.revert } : {}),
							append: (text) => {
								thread.append(text);
							},
						}).finally(() => {
							retrying.current = false;
						});
					}}
					data-qa-id="kilo-message-error-retry"
				>
					Retry
				</Button>
			</div>
		);
	}

	return (
		<ErrorPrimitive.Root className="aui-message-error-root border-border bg-background mt-2 flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
			<span className="aui-message-error-message text-destructive-foreground line-clamp-2 min-w-0 flex-1">
				{displayChatError(errorText)}
			</span>
			{offerSignIn ? (
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={() => {
						auth.login();
					}}
					disabled={signingIn}
					data-qa-id="kilo-message-error-signin"
				>
					{signingIn ? "Connecting…" : "Connect"}
				</Button>
			) : null}
		</ErrorPrimitive.Root>
	);
};

const AssistantMessage: FC = () => {
	const { ToolFallback: ToolFallbackComponent = FallbackTool } =
		useContext(ThreadComponentsContext);
	const messageId = useAuiState((s) => s.message.id);
	const messageParts = useAuiState((s) => s.message.parts);
	const planThread = usePlanThreadProjection();
	const hiddenPlanCallIds = getPlanProjectionForMessage(planThread, messageId)?.hiddenCallIds;
	const pendingSuggestion = usePendingKiloSuggestion();
	const hasInFlightActivity = useAuiState((s) => messageHasInFlightActivity(s.message.parts));
	const status = useAuiState((s) => s.message.status);
	const turnStartedAt = useAuiState((s) => {
		for (let index = s.message.index - 1; index >= 0; index--) {
			const message = s.thread.messages[index];
			if (message?.role === "user") return message.createdAt.getTime();
		}
		return s.message.createdAt.getTime();
	});
	const turnCompletedAt = useAuiState((s) => {
		const custom = s.message.metadata?.custom as
			| { opencode?: { originalMessage?: { time?: { completed?: unknown } } } }
			| undefined;
		const completed = custom?.opencode?.originalMessage?.time?.completed;
		return typeof completed === "number" ? completed : undefined;
	});
	const virtualize = useVirtualizeMessage();
	const threadOwnsRun = useAuiState(
		(s) => s.thread.isRunning && s.message.index === s.thread.messages.length - 1,
	);
	const isRunning = status?.type === "running" || threadOwnsRun;
	const interrupted = status?.type === "incomplete" && status.reason === "cancelled";
	const wasRunningRef = useRef(isRunning);
	const animateWorkCollapse = wasRunningRef.current && !isRunning;
	useEffect(() => {
		wasRunningRef.current = isRunning;
	}, [isRunning]);
	const duration = isRunning
		? null
		: formatTurnDuration(Math.max(0, (turnCompletedAt ?? Date.now()) - turnStartedAt));
	const groupActivityParts = useMemo(
		() =>
			isRunning
				? createActivityGroupBy(messageParts, { hiddenPlanCallIds })
				: createTurnWorkGroupBy(messageParts, { hiddenPlanCallIds }),
		[hiddenPlanCallIds, isRunning, messageParts],
	);

	// Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
	const ACTION_BAR_HEIGHT = "min-h-6";

	return (
		<MessagePrimitive.Root
			data-slot="aui_assistant-message-root"
			data-role="assistant"
			className={cn(
				"fade-in slide-in-from-bottom-1 animate-in relative -mb-7 pb-6 duration-150",
				virtualize && "[contain-intrinsic-size:auto_200px] [content-visibility:auto]",
			)}
		>
			<div
				data-slot="aui_assistant-message-content"
				className="text-foreground px-2 leading-relaxed wrap-break-word"
			>
				{isRunning ? <TurnWorkHeader startedAt={turnStartedAt} /> : null}
				<MessagePrimitive.GroupedParts
					indicator={assistantWorkingIndicatorMode(pendingSuggestion, hasInFlightActivity)}
					groupBy={groupActivityParts}
				>
					{({ part, children }) => {
						switch (part.type) {
							case "group-turn-work":
								return (
									<TurnWorkDisclosure
										animateCollapse={animateWorkCollapse}
										duration={duration}
										interrupted={interrupted}
									>
										{children}
									</TurnWorkDisclosure>
								);
							case "group-activity":
								return <ActivityGroup group={part}>{children}</ActivityGroup>;
							case "group-thinking":
							case "group-editing":
							case "group-writing":
							case "group-reading":
							case "group-searching":
							case "group-web":
							case "group-terminal":
							case "group-planning":
							case "group-asking":
							case "group-suggesting":
							case "group-skill":
							case "group-subagent":
							case "group-tools": {
								const kind = activityKindFromGroupKey(part.type);
								if (!kind) return null;
								return (
									<ActivitySubgroup kind={kind} group={part}>
										{children}
									</ActivitySubgroup>
								);
							}
							case "text":
								return <MarkdownText />;
							case "reasoning":
								return <Reasoning {...part} />;
							case "tool-call":
								return part.toolUI ?? <ToolFallbackComponent {...part} />;
							case "data":
								return part.dataRendererUI;
							case "indicator":
								return <AssistantWorkingIndicator />;
							default: {
								if (
									typeof part.type === "string" &&
									part.type.startsWith("group-mcp-") &&
									"indices" in part
								) {
									const kind = activityKindFromGroupKey(part.type);
									if (!kind) return null;
									return (
										<ActivitySubgroup kind={kind} group={part}>
											{children}
										</ActivitySubgroup>
									);
								}
								return null;
							}
						}
					}}
				</MessagePrimitive.GroupedParts>
				<MessageError />
			</div>

			<div
				data-slot="aui_assistant-message-footer"
				className={cn("mt-3 ms-2 flex items-center", ACTION_BAR_HEIGHT)}
			>
				<BranchPicker />
				<AssistantActionBar />
			</div>
		</MessagePrimitive.Root>
	);
};

const AssistantActionMoreTrigger: FC = () => {
	return (
		<TooltipProvider>
			<Tooltip disableHoverablePopup>
				<TooltipTrigger
					render={
						<ActionBarMorePrimitive.Trigger
							render={
								<Button
									variant="ghost"
									size="icon"
									className="aui-button-icon data-[state=open]:bg-accent size-6 p-1 active:scale-90"
								/>
							}
						/>
					}
				>
					<MoreHorizontalIcon className="size-3.5" />
					<span className="sr-only">More</span>
				</TooltipTrigger>
				<TooltipContent side="bottom" className="pointer-events-none">
					More
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};

const AssistantActionBar: FC = () => {
	return (
		<ActionBarPrimitive.Root
			hideWhenRunning
			autohide="not-last"
			className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ms-1 flex gap-1 duration-200"
		>
			<MessageCopyButton />
			<ActionBarMorePrimitive.Root>
				<AssistantActionMoreTrigger />
				<ActionBarMorePrimitive.Content
					side="bottom"
					align="start"
					sideOffset={6}
					className="aui-action-bar-more-content bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1.5 shadow-lg backdrop-blur-sm"
				>
					<ActionBarPrimitive.ExportMarkdown
						render={
							<ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none select-none" />
						}
					>
						<DownloadIcon className="size-4" />
						Export as Markdown
					</ActionBarPrimitive.ExportMarkdown>
				</ActionBarMorePrimitive.Content>
			</ActionBarMorePrimitive.Root>
		</ActionBarPrimitive.Root>
	);
};

const UserMessage: FC = () => {
	const virtualize = useVirtualizeMessage();

	return (
		<MessagePrimitive.Root
			data-slot="aui_user-message-root"
			className={cn(
				"fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 ps-2 duration-150 [&:where(>*)]:col-start-2",
				virtualize && "[contain-intrinsic-size:auto_200px] [content-visibility:auto]",
			)}
			data-role="user"
		>
			<UserMessageAttachments />

			<div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
				<div className="aui-user-message-content border-border bg-card text-foreground dark:border-muted-foreground/15 rounded-xl border px-4 py-2 text-sm wrap-break-word whitespace-pre-wrap empty:hidden">
					<MessagePrimitive.Parts components={{ Text: KiloDirectiveText }} />
				</div>
			</div>

			<BranchPicker
				data-slot="aui_user-branch-picker"
				className="col-span-full col-start-1 row-start-3 -me-1 justify-end"
			/>
		</MessagePrimitive.Root>
	);
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => {
	return (
		<BranchPickerPrimitive.Root
			hideWhenSingleBranch
			className={cn(
				"aui-branch-picker-root text-muted-foreground -ms-2 me-2 inline-flex items-center text-xs",
				className,
			)}
			{...rest}
		>
			<BranchPickerPrimitive.Previous render={<TooltipIconButton tooltip="Previous" />}>
				<ChevronLeftIcon />
			</BranchPickerPrimitive.Previous>
			<span className="aui-branch-picker-state font-medium">
				<BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
			</span>
			<BranchPickerPrimitive.Next render={<TooltipIconButton tooltip="Next" />}>
				<ChevronRightIcon />
			</BranchPickerPrimitive.Next>
		</BranchPickerPrimitive.Root>
	);
};
