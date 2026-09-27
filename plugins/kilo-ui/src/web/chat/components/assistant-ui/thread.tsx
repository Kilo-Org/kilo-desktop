"use client";

import {
	ComposerAddAttachment,
	ComposerAttachments,
	UserMessageAttachments,
} from "./attachment.js";
import { RevertToHereButton } from "./revert-to-here-button.js";
import { RevertPendingProvider, useRevertPending } from "./revert-pending.js";
import { useIsAfterPendingBoundary } from "./checkpoint-revert.js";
import { ComposerDraftFooter } from "./composer-draft-footer.js";
import { ComposerFooter } from "./composer-footer.js";
import { ComposerHeader } from "./composer-header.js";
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
import {
	ActivityGroup,
	ActivitySubgroup,
	ManualDisclosureProvider,
	useHasOpenManualDisclosure,
} from "../tools/activity-group.js";
import {
	DELEGATION_GROUP_PREFIX,
	createActivityGroupBy,
	createTurnWorkGroupBy,
} from "../tools/activity-grouping.js";
import { DelegationGroup } from "../tools/delegation-group.js";
import {
	COMPOSER_SHELF_LIST_CLASS,
	COMPOSER_SHELF_ROW_CLASS,
	ComposerShelf,
	ComposerShelfToggle,
} from "../composer-shelf.js";
import { OpenCodeComposerInteraction } from "../tools/opencode-composer-interaction.js";
import { OPENCODE_SNAPSHOT_PROGRESS_PART } from "../tools/opencode-data-part.js";
import { FallbackTool } from "../tools/opencode-tools.js";
import { activityKindFromGroupKey, isDelegationTool } from "../tools/tool-categories.js";
import { getPlanProjectionForMessage } from "../../plan/index.js";
import { useApprovePlan } from "../../plan/use-approve-plan.js";
import { Item, ItemActions, ItemContent } from "@kilo-desktop/ui/components/item";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Avatar, AvatarFallback, AvatarGroup } from "@kilo-desktop/ui/components/avatar";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";
import { toast } from "@kilo-desktop/ui/components/sonner";
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
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CircleCheckIcon,
	CornerDownLeftIcon,
	DownloadIcon,
	EllipsisIcon,
	FileTextIcon,
	GitForkIcon,
	MicIcon,
	SquareIcon,
	Trash2Icon,
} from "lucide-react";
import {
	createContext,
	useContext,
	useEffect,
	useLayoutEffect,
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
import { ComposerTaskList } from "../../tasks/ComposerTaskList.js";
import { ComposerSubagentStrip } from "../../subagents/ComposerSubagentStrip.js";
import { useDelegationRevealNonce } from "../../subagents/delegation-reveal-store.js";
import { useSubagentActivity } from "../../subagents/SubagentActivityContext.js";
import { useOptionalOpenCodeRuntimeExtras } from "../../runtime/use-optional-opencode-runtime-extras.js";
import { usePendingInteractions } from "../../subagents/PendingInteractionsContext.js";
import {
	assistantWorkingIndicatorMode,
	messageHasInFlightActivity,
	openCodeTextIsStreaming,
} from "./assistant-working-indicator-mode.js";
import { useLocalInferenceStatus } from "../../use-local-inference-status.js";
import { LOCAL_MODEL_SERVER_PROVIDER_ID } from "../../../providers/provider-ids.js";
import { retryFailedPrompt } from "./retry-failed-prompt.js";
import { retryFailedTurn } from "./retry-failed-turn.js";
import { useIsSettingUpWorktree } from "../../worktree-setup/WorktreeSetupContext.js";

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

/** Shared by the live and read-only thread viewports. */
const THREAD_VIEWPORT_CLASS =
	"relative flex flex-1 flex-col items-center overflow-x-hidden overflow-y-auto scroll-smooth";

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
const isDraftView = (s: AssistantState) =>
	s.thread.messages.length === 0 && s.threadListItem.status === "new";

export const Thread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS }) => {
	const isDraft = useAuiState(isDraftView);

	return (
		<ThreadComponentsContext.Provider value={components}>
			<RevertPendingProvider>
				<ThreadRoot isDraft={isDraft} />
			</RevertPendingProvider>
		</ThreadComponentsContext.Provider>
	);
};

/** Message-only thread surface for transcripts hosted by a readonly runtime. */
export const ReadonlyThread: FC<ThreadProps> = ({ components = EMPTY_COMPONENTS }) => (
	<ThreadComponentsContext.Provider value={components}>
		<RevertPendingProvider>
			<ThreadPrimitive.Root
				className="aui-root aui-thread-root bg-pane @container flex h-full min-h-0 flex-col"
				style={{ ["--thread-max-width" as string]: "48rem" }}
			>
				<ThreadPrimitive.Viewport
					autoScroll
					turnAnchor="bottom"
					data-slot="aui_readonly-thread-viewport"
					className={cn(THREAD_VIEWPORT_CLASS, "[scrollbar-gutter:stable_both-edges]")}
				>
					<div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-1 pt-4">
						<div className="flex flex-col gap-y-4 empty:hidden">
							<ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
						</div>
					</div>
				</ThreadPrimitive.Viewport>
			</ThreadPrimitive.Root>
		</RevertPendingProvider>
	</ThreadComponentsContext.Provider>
);

const ComposerDockMask: FC = () => {
	return (
		<>
			<div aria-hidden className="bg-pane pointer-events-none absolute -inset-x-4 top-full h-4" />
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
				{!isDraft ? <ComposerHeader /> : null}
				<ThreadComposerSlot />
				{isDraft ? <ComposerDraftFooter /> : null}
			</div>
		</div>
	);
};

const ThreadRoot: FC<{ isDraft: boolean }> = ({ isDraft }) => {
	return (
		<ThreadPrimitive.Root
			className={cn(
				"aui-root aui-thread-root @container flex h-full flex-col bg-pane",
				isDraft
					? "[--composer-bg:var(--composer-draft,var(--color-card))]"
					: "[--composer-bg:var(--pane-raised)]",
			)}
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
				className={cn(THREAD_VIEWPORT_CLASS, !isDraft && "[scrollbar-gutter:stable_both-edges]")}
			>
				<ScrollToBottomOnSend />
				{/* A gradient, not a `scroll-fade` mask: masking the scroller disables the
				    docked composer's backdrop blur in Chromium. */}
				<div
					aria-hidden
					className="from-pane pointer-events-none sticky top-0 z-10 -mb-6 h-6 w-full shrink-0 bg-linear-to-b to-transparent"
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
						<WorktreeSetupIndicator />
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

const WorktreeSetupIndicator: FC = () => {
	const isSettingUp = useIsSettingUpWorktree();
	if (!isSettingUp) return null;

	return (
		<div
			data-qa-id="kilo-worktree-setup"
			className="text-muted-foreground flex w-fit items-center gap-2 py-1 text-sm"
			role="status"
			aria-label="Setting up worktree"
		>
			<AvatarGroup className="*:data-[slot=avatar]:ring-pane">
				<Avatar aria-hidden className="size-6.5">
					<AvatarFallback className="relative border-0">
						<GitForkIcon className="size-3.5" />
						<svg
							data-qa-id="kilo-worktree-setup-spinner"
							aria-hidden
							viewBox="0 0 28 28"
							fill="none"
							className="pointer-events-none absolute inset-0 size-full animate-spin"
						>
							<circle
								cx="14"
								cy="14"
								r="13"
								stroke="currentColor"
								strokeOpacity={0.4}
								strokeWidth="2"
								strokeLinecap="round"
								strokeDasharray="20.4 61.3"
							/>
						</svg>
					</AvatarFallback>
				</Avatar>
			</AvatarGroup>
			<span aria-hidden className="relative inline-block font-medium">
				Setting <span className="opacity-60">up worktree</span>
				<span className="shimmer shimmer-color-foreground pointer-events-none absolute top-0 left-0 motion-reduce:animate-none">
					Setting up worktree
				</span>
			</span>
		</div>
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
					className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-muted absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
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
// never cross unrendered content. Reassert the user-send scroll when its run
// starts so the newly mounted assistant status UI is included in the target.
const SMOOTH_SCROLL_VIEWPORT_HEIGHTS = 1.5;

const ScrollToBottomOnSend: FC = () => {
	const scrollToBottom = useThreadViewport((s) => s.scrollToBottom);
	const viewport = useThreadViewport((s) => s.element.viewport);
	const isRunning = useAuiState((s) => s.thread.isRunning);
	const runStartScrollBehavior = useRef<ScrollBehavior | null>(null);
	const runStartFrame = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (runStartFrame.current !== null) window.cancelAnimationFrame(runStartFrame.current);
		},
		[],
	);
	useAuiEvent("composer.send", () => {
		const distance = viewport
			? viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
			: 0;
		const behavior =
			viewport && distance > viewport.clientHeight * SMOOTH_SCROLL_VIEWPORT_HEIGHTS
				? "instant"
				: "smooth";
		runStartScrollBehavior.current = isRunning ? null : behavior;
		scrollToBottom({ behavior });
	});
	useAuiEvent("thread.runStart", () => {
		const behavior = runStartScrollBehavior.current;
		if (!behavior) return;
		runStartScrollBehavior.current = null;
		runStartFrame.current = window.requestAnimationFrame(() => {
			runStartFrame.current = null;
			scrollToBottom({ behavior });
		});
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
						className="aui-thread-welcome-suggestion text-foreground hover:bg-muted border-border-subtle h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap transition-colors"
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
			className="border-border-subtle bg-muted flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border"
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
		<ComposerShelf data-qa-id="kilo-composer-queue">
			<ComposerShelfToggle
				collapsed={collapsed}
				aria-controls="kilo-composer-queue-items"
				onClick={() => setCollapsed((value) => !value)}
				data-qa-id="kilo-composer-queue-toggle"
			>
				<span>{queueLength} queued</span>
			</ComposerShelfToggle>
			{!collapsed ? (
				<div
					id="kilo-composer-queue-items"
					className={cn(COMPOSER_SHELF_LIST_CLASS, "flex flex-col")}
				>
					<ComposerPrimitive.Queue>
						{({ queueItem }) => <QueueItemRow queueItem={queueItem} showEnterHint={steerOnEnter} />}
					</ComposerPrimitive.Queue>
				</div>
			) : null}
		</ComposerShelf>
	);
};

const QueueItemRow: FC<{ queueItem: QueueItemState; showEnterHint: boolean }> = ({
	queueItem,
	showEnterHint,
}) => {
	const isFirst = useAuiState((s) => s.composer.queue[0]?.id === queueItem.id);
	const attachmentPreview = (queueItem as QueueItemWithAttachmentPreview).attachmentPreview;

	return (
		<Item
			size="xs"
			className={COMPOSER_SHELF_ROW_CLASS}
			data-qa-id="kilo-composer-queue-item"
			data-queue-item-id={queueItem.id}
		>
			{attachmentPreview ? <QueueAttachmentPreview attachment={attachmentPreview} /> : null}
			<ItemContent className="min-w-0">
				<QueueItemPrimitive.Text className="text-foreground/90 truncate text-sm" />
			</ItemContent>
			<ItemActions className="gap-1.5">
				<QueueItemPrimitive.Steer
					render={
						<Button
							type="button"
							size="xs"
							variant="ghost"
							className="text-muted-foreground hover:text-foreground text-[11px] opacity-65 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
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
							className="text-muted-foreground hover:text-destructive size-6 opacity-65 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
							aria-label="Delete queued message"
							data-qa-id="kilo-composer-queue-delete"
						/>
					}
				>
					<Trash2Icon className="size-3" />
				</QueueItemPrimitive.Remove>
			</ItemActions>
		</Item>
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
	const inferenceStatus = useLocalInferenceStatus();
	const { model } = useChatModelSelection();
	const isLoadingModel =
		model?.providerID === LOCAL_MODEL_SERVER_PROVIDER_ID &&
		isLocalModelLoadingStatus(inferenceStatus) &&
		inferenceStatus.modelId === model.modelID;

	const showPlanFollowupActions = canReply && !isConnecting && !isPending && !isLoadingModel;

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
				<ComposerSubagentStrip />
				<ComposerTaskList />
				<ComposerQueue steerOnEnter={steerQueueOnEnter} />
				<ComposerPrimitive.AttachmentDropzone
					render={
						<div
							data-slot="aui_composer-shell"
							className={cn(
								"border-border chat-composer-surface data-[dragging=true]:border-ring flex w-full flex-col gap-2 rounded-(--composer-radius) border px-(--composer-padding) pt-2 pb-(--composer-padding) transition-[border-color,outline-color,box-shadow] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]",
								isDraft
									? "relative z-10 bg-(--composer-bg) focus-within:border-(--composer-focus-stroke)"
									: "relative z-10 chat-composer-glass shadow-composer",
							)}
						/>
					}
				>
					<ComposerAttachments />
					<KiloLexicalComposerInput
						ref={inputRef}
						disabled={isConnecting}
						submitMode={isLoadingModel ? "none" : "enter"}
						onKeyDown={handleInputKeyDown}
					/>
					<ComposerTriggers />
					<ComposerAction
						isConnecting={isConnecting}
						isLoadingModel={isLoadingModel}
						isConnectionPending={isPending}
						onSendWhenConnected={sendWhenConnected}
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
	modelSelectorSide: "top" | "bottom";
	showPlanFollowupActions: boolean;
	planActionPending: boolean;
	onRefine: () => void;
}> = ({
	isConnecting,
	isLoadingModel,
	isConnectionPending,
	onSendWhenConnected,
	modelSelectorSide,
	showPlanFollowupActions,
	planActionPending,
	onRefine,
}) => {
	const aui = useAui();
	const isRunning = useAuiState((s) => s.thread.isRunning);
	const { hasActiveSubagents, stopAllSubagents } = useSubagentActivity();
	const [isStoppingAll, setIsStoppingAll] = useState(false);
	const stopEverything = () => {
		if (isStoppingAll) return;
		// cancelRun pauses the message queue; stopAllSubagents aborts the parent's
		// whole session tree regardless of whether the UI believes it is running,
		// and surfaces failures. The server treats the duplicate abort as a no-op.
		if (isRunning) aui.thread().cancelRun();
		setIsStoppingAll(true);
		void stopAllSubagents().finally(() => setIsStoppingAll(false));
	};
	const canSend = useAuiState((s) => s.composer.canSend);
	const isComposerEmpty = useAuiState((s) => s.composer.isEmpty);
	const canQueue = useAuiState((s) => s.thread.capabilities.queue);
	const isPromptBusy = isRunning || hasActiveSubagents;
	const isSendLocked = isConnecting || isLoadingModel;
	const lockLabel = isConnecting ? "Connecting to Kilo" : LOCAL_MODEL_LOADING_TITLE;

	return (
		<div className="aui-composer-action-wrapper relative flex items-center gap-1.5">
			<div className="flex shrink-0 items-center gap-1">
				<ComposerAddAttachment />
				<KiloAgentSelector />
			</div>
			{/* Only the model name absorbs overflow; the action buttons keep their size. */}
			<div className="flex min-w-0 flex-1 justify-end">
				<KiloModelSelector side={modelSelectorSide} />
			</div>
			<div className="flex shrink-0 items-center gap-1.5">
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
									className="aui-composer-stop-dictation text-destructive size-7 rounded-full"
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
						<Spinner
							className={cn(
								"size-4.5",
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
						{planActionPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
						Refine
					</Button>
				) : null}
				{!showPlanFollowupActions && !isSendLocked && !isPromptBusy && !isConnectionPending ? (
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
				) : null}
				{(!showPlanFollowupActions || hasActiveSubagents) && !isSendLocked && isPromptBusy ? (
					<>
						{!showPlanFollowupActions && canQueue && !isComposerEmpty ? (
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
						{hasActiveSubagents ? (
							<TooltipIconButton
								tooltip="Stop generating"
								type="button"
								variant="default"
								size="icon"
								className="aui-composer-cancel size-7 rounded-full"
								aria-label="Stop generating"
								disabled={isStoppingAll}
								onClick={stopEverything}
							>
								<SquareIcon className="size-3.5 fill-current" />
							</TooltipIconButton>
						) : (
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
						)}
					</>
				) : null}
			</div>
		</div>
	);
};

const CONSIDERING_NEXT_STEPS = "Considering next steps";
const SNAPSHOT_PROGRESS_STATUS = "Initializing snapshot…";
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

const AssistantWorkingIndicator: FC<{ active: boolean; overlay: boolean }> = ({
	active,
	overlay,
}) => {
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
		setVisibleLabel(null);
		if (!active) return;

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
	}, [active, label, turnStartedAt]);

	const isVisible = active && visibleLabel === label;

	return (
		<div
			data-slot="aui_assistant-message-indicator"
			className={cn(
				"text-muted-foreground flex w-fit items-center gap-2 py-1 text-sm",
				overlay && "absolute mt-3",
				!isVisible && "invisible",
			)}
			role={isVisible ? "status" : undefined}
			aria-label={isVisible ? label : undefined}
			aria-hidden={!isVisible}
		>
			<AvatarGroup aria-hidden className="*:data-[slot=avatar]:ring-pane -space-x-1">
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
		className="text-muted-foreground border-border-subtle mb-2 flex w-full items-center border-b pt-2 pb-2 text-xs"
		role="status"
		data-qa-id="kilo-turn-working"
	>
		<span>
			Working for <WorkingTimer startedAt={startedAt} />
		</span>
	</div>
);

const turnSummaryLabel = (interrupted: boolean, duration: string | null) =>
	interrupted
		? duration
			? `You stopped after ${duration}`
			: "You stopped this response"
		: duration
			? `Worked for ${duration}`
			: "Worked";

/**
 * Says a turn was stopped when it has no work fold to carry that label, e.g.
 * a stop before any output or while only text was streaming.
 */
const TurnStoppedNote: FC<{ duration: string | null }> = ({ duration }) => (
	<p className="text-muted-foreground mt-2 text-xs" data-qa-id="kilo-turn-stopped">
		{turnSummaryLabel(true, duration)}
	</p>
);

const TurnWorkDisclosure: FC<
	PropsWithChildren<{
		animateCollapse: boolean;
		duration: string | null;
		interrupted: boolean;
		/** A pending jump to a delegation inside this fold. */
		revealNonce: number | null;
		/** Reports whether the fold is on screen, so the message can skip its own stop note. */
		onPresenceChange: (present: boolean) => void;
	}>
> = ({ animateCollapse, duration, interrupted, revealNonce, onPresenceChange, children }) => {
	useLayoutEffect(() => {
		onPresenceChange(true);
		return () => onPresenceChange(false);
	}, [onPresenceChange]);
	const hasOpenManualDisclosure = useHasOpenManualDisclosure();
	const [open, setOpen] = useState(animateCollapse || hasOpenManualDisclosure);
	// `animateCollapse` is true only for the render in which the turn ends. The
	// collapse is latched so the re-render that follows (e.g. `onPresenceChange`
	// above) cannot cancel it, and it is one-shot so closing a disclosure later
	// never folds work the user reopened.
	const pendingCollapseRef = useRef(animateCollapse);
	useEffect(() => {
		if (revealNonce === null) return;
		// A reveal outranks the end-of-turn collapse, even one already scheduled.
		pendingCollapseRef.current = false;
		setOpen(true);
	}, [revealNonce]);
	useEffect(() => {
		if (!pendingCollapseRef.current) return;
		if (hasOpenManualDisclosure) {
			pendingCollapseRef.current = false;
			return;
		}
		const frameId = window.requestAnimationFrame(() => {
			if (!pendingCollapseRef.current) return;
			pendingCollapseRef.current = false;
			setOpen(false);
		});
		return () => window.cancelAnimationFrame(frameId);
	}, [hasOpenManualDisclosure]);
	const label = turnSummaryLabel(interrupted, duration);
	return (
		<Collapsible
			open={open}
			onOpenChange={setOpen}
			className="mb-3 w-full pt-1"
			data-qa-id="kilo-turn-work"
		>
			<CollapsibleTrigger
				className="text-muted-foreground hover:text-foreground border-border-subtle flex w-full items-center gap-1 border-b pt-1 pb-3 text-xs transition-colors"
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
	const { connection } = useChatConnection();
	const { model } = useChatModelSelection();
	const errorText = useAuiState((s) => messageErrorText(s.message.status));
	const isLast = useAuiState((s) => s.message.isLast);
	const isKiloModel = model !== undefined && isKiloGatewayProvider({ id: model.providerID });
	const offerSignIn = offerKiloSignIn(auth, isKiloModel);
	const signedIn = auth.authenticated === true && isKiloSignInError(errorText);
	const signingIn = auth.deviceAuth.status === "initiating" || auth.deviceAuth.status === "waiting";
	const retrying = useRef(false);
	const session = extras?.session ?? null;

	if (signedIn) {
		return (
			<div
				role="status"
				className="border-border bg-background mt-2 flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
				data-qa-id="kilo-message-error-signed-in"
			>
				<span className="flex min-w-0 items-center gap-2">
					<CircleCheckIcon className="text-primary-ink size-4 shrink-0" />
					<span>You&rsquo;re signed in to Kilo.</span>
				</span>
				{isLast ? (
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
								...(session && connection
									? {
											retry: (userMessageId) =>
												retryFailedTurn({
													connection,
													sessionID: session.id,
													directory: session.directory,
													messageID: userMessageId,
													...(model ? { model } : {}),
												}),
										}
									: {}),
								append: (text) => {
									thread.append(text);
								},
							})
								.catch(() => {
									toast.error("Could not retry the prompt");
								})
								.finally(() => {
									retrying.current = false;
								});
						}}
						data-qa-id="kilo-message-error-retry"
					>
						Retry
					</Button>
				) : null}
			</div>
		);
	}

	return (
		<ErrorPrimitive.Root className="aui-message-error-root border-border bg-background mt-2 flex items-center justify-between gap-3 rounded-md border p-3 text-sm">
			<span className="aui-message-error-message text-destructive line-clamp-2 min-w-0 flex-1">
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
					{signingIn ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
					{signingIn ? "Connecting…" : "Connect"}
				</Button>
			) : null}
		</ErrorPrimitive.Root>
	);
};

const ACTION_BAR_PT = "pt-1.5";
// Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`;

const AssistantMessage: FC = () => {
	const { ToolFallback: ToolFallbackComponent = FallbackTool } =
		useContext(ThreadComponentsContext);
	const messageId = useAuiState((s) => s.message.id);
	const messageParts = useAuiState((s) => s.message.parts);
	const planThread = usePlanThreadProjection();
	const hiddenPlanCallIds = getPlanProjectionForMessage(planThread, messageId)?.hiddenCallIds;
	const pendingInteractions = usePendingInteractions();
	const pendingUserInteractions =
		pendingInteractions.questions.length + pendingInteractions.permissions.length;
	const hasInFlightActivity = useAuiState((s) => messageHasInFlightActivity(s.message.parts));
	const isStreamingText = useAuiState((s) => {
		const custom = s.message.metadata?.custom as { opencode?: { parts?: unknown } } | undefined;
		return openCodeTextIsStreaming(custom?.opencode?.parts);
	});
	const hasRenderablePart = useAuiState((s) =>
		s.message.parts.some(
			(part) =>
				(part.type === "text" && Boolean(part.text.trim())) ||
				(part.type === "reasoning" && Boolean(part.text.trim())) ||
				part.type === "tool-call",
		),
	);
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
	const { hasActiveSubagents } = useSubagentActivity();
	const isLastMessage = useAuiState((s) => s.message.index === s.thread.messages.length - 1);
	const isRunning =
		status?.type === "running" || threadOwnsRun || (isLastMessage && hasActiveSubagents);
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
	const delegationToolCallIds = useMemo(
		() =>
			messageParts.flatMap((part) =>
				part.type === "tool-call" && isDelegationTool(part.toolName) ? [part.toolCallId] : [],
			),
		[messageParts],
	);
	const delegationRevealNonce = useDelegationRevealNonce(delegationToolCallIds);
	const [hasTurnWorkFold, setHasTurnWorkFold] = useState(false);
	// Dim while a revert is in flight from a boundary before this message.
	const pendingId = useRevertPending().pendingId;
	const dimmed = useIsAfterPendingBoundary(pendingId);

	return (
		<MessagePrimitive.Root
			data-slot="aui_assistant-message-root"
			data-role="assistant"
			className={cn(
				"fade-in slide-in-from-bottom-1 animate-in relative -mb-7.5 pb-7.5 duration-150 transition-opacity",
				virtualize && "[contain-intrinsic-size:auto_200px] [content-visibility:auto]",
				dimmed ? "pointer-events-none opacity-50" : undefined,
			)}
		>
			<ManualDisclosureProvider>
				<div
					data-slot="aui_assistant-message-content"
					className="text-foreground px-2 leading-relaxed wrap-break-word"
				>
					{isRunning ? <TurnWorkHeader startedAt={turnStartedAt} /> : null}
					<MessagePrimitive.GroupedParts indicator="never" groupBy={groupActivityParts}>
						{({ part, children }) => {
							if (part.type.startsWith("group-activity-") && "indices" in part) {
								return <ActivityGroup group={part}>{children}</ActivityGroup>;
							}
							if (part.type.startsWith(DELEGATION_GROUP_PREFIX) && "indices" in part) {
								return <DelegationGroup group={part}>{children}</DelegationGroup>;
							}
							switch (part.type) {
								case "group-turn-work":
									return (
										<TurnWorkDisclosure
											animateCollapse={animateWorkCollapse}
											revealNonce={delegationRevealNonce}
											duration={duration}
											interrupted={interrupted}
											onPresenceChange={setHasTurnWorkFold}
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
					{interrupted && !isRunning && !hasTurnWorkFold ? (
						<TurnStoppedNote duration={duration} />
					) : null}
					{isRunning ? (
						<AssistantWorkingIndicator
							overlay={hasRenderablePart}
							active={
								assistantWorkingIndicatorMode({
									pendingUserInteractions,
									hasInFlightActivity,
									isStreamingText,
									hasActiveSubagents,
								}) !== "never"
							}
						/>
					) : null}
					<MessageError />
				</div>

				<div
					data-slot="aui_assistant-message-footer"
					className={cn("mt-3 ms-2 flex items-center", ACTION_BAR_HEIGHT)}
				>
					<BranchPicker />
					<AssistantActionBar hidden={isRunning} />
				</div>
			</ManualDisclosureProvider>
		</MessagePrimitive.Root>
	);
};

const AssistantActionMoreTrigger: FC = () => {
	return (
		<Tooltip disableHoverablePopup>
			<TooltipTrigger
				render={
					<ActionBarMorePrimitive.Trigger
						render={
							<Button
								variant="ghost"
								size="icon"
								className="aui-button-icon data-[state=open]:bg-muted size-6 p-1 active:scale-90"
							/>
						}
					/>
				}
			>
				<EllipsisIcon className="size-3.5" />
				<span className="sr-only">More</span>
			</TooltipTrigger>
			<TooltipContent side="bottom" className="pointer-events-none">
				More
			</TooltipContent>
		</Tooltip>
	);
};

const AssistantActionBar: FC<{ hidden: boolean }> = ({ hidden }) => {
	return (
		<ActionBarPrimitive.Root
			hideWhenRunning
			autohide="not-last"
			aria-hidden={hidden || undefined}
			className={cn(
				"aui-assistant-action-bar-root text-muted-foreground col-start-3 row-start-2 -ms-1 flex gap-1 transition-opacity duration-200",
				hidden ? "pointer-events-none opacity-0" : "opacity-100",
			)}
		>
			<MessageCopyButton />
			<ActionBarMorePrimitive.Root>
				<AssistantActionMoreTrigger />
				<ActionBarMorePrimitive.Content
					side="bottom"
					align="start"
					sideOffset={6}
					className="aui-action-bar-more-content bg-popover/95 text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-lg border p-1.5 shadow-lg backdrop-blur-sm"
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

const UserActionBar: FC = () => {
	// Always stay in DOM to avoid layout shift; drive visibility via opacity so
	// the bar fades in on hover without reflowing the bubble above it.
	const hidden = useAuiState(
		(s) =>
			s.message.id.startsWith("opencode-new-user:") ||
			(!s.message.isHovering && (s.thread.isRunning || !s.message.isLast)),
	);

	return (
		<ActionBarPrimitive.Root
			className={cn(
				"aui-user-action-bar-root text-muted-foreground absolute right-0 bottom-0 flex justify-end gap-1 transition-opacity duration-200",
				hidden ? "pointer-events-none opacity-0" : "opacity-100",
			)}
		>
			<RevertToHereButton />
			<MessageCopyButton />
		</ActionBarPrimitive.Root>
	);
};

const UserMessage: FC = () => {
	const virtualize = useVirtualizeMessage();
	// Dim while a revert is in flight from a boundary before this message.
	const pendingId = useRevertPending().pendingId;
	const dimmed = useIsAfterPendingBoundary(pendingId);

	return (
		<MessagePrimitive.Root
			data-slot="aui_user-message-root"
			className={cn(
				"grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 transition-opacity [&:where(>*)]:col-start-2",
				virtualize && "[contain-intrinsic-size:auto_200px] [content-visibility:auto]",
				dimmed ? "pointer-events-none opacity-50" : undefined,
			)}
			data-role="user"
		>
			<UserMessageAttachments />

			<div className="aui-user-message-content-wrapper relative col-start-2 w-fit max-w-full min-w-0 justify-self-end pb-7">
				<div className="aui-user-message-content text-foreground bg-pane-raised rounded-xl px-4 py-2 text-sm wrap-break-word whitespace-pre-wrap empty:hidden">
					<MessagePrimitive.Parts components={{ Text: KiloDirectiveText }} />
				</div>
				<UserActionBar />
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
