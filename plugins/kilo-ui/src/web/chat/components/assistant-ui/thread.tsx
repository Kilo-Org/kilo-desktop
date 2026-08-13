"use client";

import {
	ComposerAddAttachment,
	ComposerAttachments,
	UserMessageAttachments,
} from "./attachment.js";
import { ComposerDraftFooter } from "./composer-draft-footer.js";
import { DraftWelcomeHeadline } from "./draft-welcome-headline.js";
import { ThreadFollowupSuggestions } from "./follow-up-suggestions.js";
import { KiloAgentSelector } from "./kilo-agent-selector.js";
import { KiloModelSelector } from "./kilo-model-selector.js";
import { MarkdownText } from "./markdown-text.js";
import { MessageCopyButton } from "./message-copy-button.js";
import { Reasoning } from "./reasoning.js";
import { TooltipIconButton } from "./tooltip-icon-button.js";
import { ActivityGroup, ActivitySubgroup } from "../tools/activity-group.js";
import { isHiddenOpenCodeDataPart } from "../tools/opencode-data-part.js";
import { OpenCodeComposerInteraction } from "../tools/opencode-composer-interaction.js";
import { FallbackTool } from "../tools/opencode-tools.js";
import { getGroupKeyForTool, activityKindFromGroupKey } from "../tools/tool-categories.js";
import {
	getPlanProjectionForMessage,
	shouldExcludeToolCallFromActivityGroup,
} from "../../plan/index.js";
import { useApprovePlan } from "../../plan/use-approve-plan.js";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
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
	getMcpAppFromToolPart,
	MessagePrimitive,
	SuggestionPrimitive,
	ThreadPrimitive,
	type ToolCallMessagePartComponent,
	useAui,
	useAuiState,
} from "@assistant-ui/react";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	DownloadIcon,
	Loader2Icon,
	MicIcon,
	MoreHorizontalIcon,
	SquareIcon,
} from "lucide-react";
import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
	type ComponentType,
	type FC,
	type FormEvent,
	type KeyboardEvent,
} from "react";

import { useChatAgentSelection } from "../../agent-selection/ChatAgentSelectionContext.js";
import {
	cycleCatalogAgent,
	OPTIMISTIC_AGENT_CATALOG,
} from "../../agent-selection/agent-catalog.js";
import { useChatConnection } from "../../connection/ChatConnectionContext.js";
import { usePlanThreadProjection } from "../../plan/use-plan-thread-projection.js";

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
const isDraftView = (s: AssistantState) =>
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
			{/* Opaque floor under the shell — covers bottom inset without overflowing (no w-screen). */}
			<div
				aria-hidden
				className="bg-muted pointer-events-none absolute -inset-x-4 top-full h-4 md:h-6"
			/>
			<div aria-hidden className="composer-corner-fill composer-corner-fill-tl" />
			<div aria-hidden className="composer-corner-fill composer-corner-fill-tr" />
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
			{/* Glow is absolutely positioned so it does not expand layout width; horizontal
			    bleed is clipped by the thread viewport (`overflow-x-hidden`), not a tight
			    local overflow box that cuts the blur into a hard rectangle. */}
			<div className="relative">
				{isDraft ? (
					<div
						aria-hidden="true"
						className="fade-in zoom-in-40 blur-in-[90px] motion-safe:animate-in fill-mode-both bg-primary/8 dark:bg-primary/15 pointer-events-none absolute top-1/2 left-1/2 h-[calc(100%+10rem)] w-[calc(100%+11rem)] -translate-x-1/2 -translate-y-1/2 rounded-[50%] blur-[90px] duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)]"
					/>
				) : null}
				<div className="relative z-10 flex flex-col">
					<div className="relative z-10">
						<ThreadComposerSlot />
					</div>
					{isDraft ? <ComposerDraftFooter /> : null}
				</div>
			</div>
		</div>
	);
};

const ThreadRoot: FC<{ isDraft: boolean }> = ({ isDraft }) => {
	return (
		<ThreadPrimitive.Root
			className="aui-root aui-thread-root bg-muted @container flex h-full flex-col [--composer-bg:var(--color-muted)] dark:[--composer-bg:var(--color-background)]"
			style={{
				["--thread-max-width" as string]: "44rem",
				["--composer-radius" as string]: "1.5rem",
				["--composer-padding" as string]: "8px",
			}}
		>
			<ThreadPrimitive.Viewport
				turnAnchor="bottom"
				autoScroll
				data-slot="aui_thread-viewport"
				className="relative flex flex-1 flex-col overflow-x-hidden overflow-y-auto scroll-smooth"
			>
				<div
					className={cn(
						"mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-4 pt-4",
						isDraft && "justify-center",
					)}
				>
					<div data-slot="aui_message-group" className="mb-14 flex flex-col gap-y-6 empty:hidden">
						<ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
					</div>

					<ThreadPrimitive.ViewportFooter
						className={cn(
							/* Transparent so sticky glass can blur scrolled messages behind the shell. */
							"aui-thread-viewport-footer relative flex flex-col gap-4 overflow-visible pb-4 md:pb-6",
							!isDraft && "sticky bottom-0 mt-auto rounded-t-(--composer-radius)",
						)}
					>
						<ThreadScrollToBottom />
						<ThreadFollowupSuggestions />
						<div className="relative">
							<ThreadComposerBlock isDraft={isDraft} />
							{!isDraft ? <ComposerDockMask /> : null}
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

const Composer: FC = () => {
	const aui = useAui();
	const isDraft = useAuiState(isDraftView);
	const activeThreadId = useAuiState((s) => s.threadListItem.id);
	const isComposerEmpty = useAuiState((s) => s.composer.isEmpty);
	const { isPending, connectionPromise } = useChatConnection();
	const [isConnecting, setIsConnecting] = useState(false);
	const isConnectingRef = useRef(false);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const { refine, submitting, canReply } = useApprovePlan();
	const { agent, setAgent, catalog, isCatalogPending, isCatalogError } = useChatAgentSelection();

	const showPlanFollowupActions = canReply && !isConnecting && !isPending;

	useEffect(() => {
		if (!isDraft || isConnecting) return;
		inputRef.current?.focus({ preventScroll: true });
	}, [activeThreadId, isConnecting, isDraft]);

	const sendWhenConnected = () => {
		if (isConnectingRef.current) {
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

	const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
		if (!showPlanFollowupActions) return;
		// ComposerInput returns early while isRunning — intercept before that.
		event.preventDefault();
		handlePlanRefineSubmit();
	};

	return (
		<ComposerPrimitive.Root
			className="aui-composer-root relative flex w-full flex-col"
			onSubmit={handleSubmit}
		>
			<ComposerPrimitive.AttachmentDropzone
				render={
					<div
						data-slot="aui_composer-shell"
						className={cn(
							"border-border/60 data-[dragging=true]:border-ring focus-within:border-border dark:border-muted-foreground/15 dark:focus-within:border-muted-foreground/30 flex w-full flex-col gap-2 rounded-(--composer-radius) border p-(--composer-padding) transition-[border-color,box-shadow] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]",
							isDraft
								? "border-b-0 bg-(--composer-bg) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-[0_12px_28px_-12px_rgba(0,0,0,0.55)]"
								: "chat-composer-glass shadow-[0_12px_28px_-18px_rgba(0,0,0,0.40)] dark:shadow-none",
						)}
					/>
				}
			>
				<ComposerAttachments />
				<ComposerPrimitive.Input
					ref={inputRef}
					placeholder="Send a message..."
					className="aui-composer-input caret-primary placeholder:text-muted-foreground/80 max-h-32 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none disabled:cursor-not-allowed"
					minRows={2}
					autoFocus
					enterKeyHint="send"
					aria-label="Message input"
					disabled={isConnecting}
					onKeyDown={handleInputKeyDown}
				/>
				<ComposerAction
					isConnecting={isConnecting}
					isConnectionPending={isPending}
					onSendWhenConnected={sendWhenConnected}
					showPlanFollowupActions={showPlanFollowupActions}
					planActionPending={submitting}
					onRefine={refine}
				/>
			</ComposerPrimitive.AttachmentDropzone>
		</ComposerPrimitive.Root>
	);
};

const ComposerAction: FC<{
	isConnecting: boolean;
	isConnectionPending: boolean;
	onSendWhenConnected: () => void;
	showPlanFollowupActions: boolean;
	planActionPending: boolean;
	onRefine: () => void;
}> = ({
	isConnecting,
	isConnectionPending,
	onSendWhenConnected,
	showPlanFollowupActions,
	planActionPending,
	onRefine,
}) => {
	const isRunning = useAuiState((s) => s.thread.isRunning);
	const canSend = useAuiState((s) => s.composer.canSend);
	const isComposerEmpty = useAuiState((s) => s.composer.isEmpty);

	return (
		<div className="aui-composer-action-wrapper relative flex items-center justify-between">
			<div className="flex min-w-0 items-center gap-1">
				<ComposerAddAttachment />
				<KiloAgentSelector />
			</div>
			<div className="flex items-center gap-1.5">
				<KiloModelSelector />
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
				{isConnecting ? (
					<TooltipIconButton
						tooltip="Connecting to Kilo"
						side="bottom"
						type="button"
						variant="default"
						size="icon"
						disabled
						className="aui-composer-connecting size-7 rounded-full"
						aria-label="Connecting to Kilo"
						data-qa-id="kilo-composer-connecting"
					>
						<Loader2Icon className="aui-composer-connecting-icon size-4.5 animate-spin" />
					</TooltipIconButton>
				) : null}
				{!isConnecting && !isRunning && isConnectionPending ? (
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
				{!showPlanFollowupActions && !isConnecting && !isRunning && !isConnectionPending ? (
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
							/>
						}
					>
						<ArrowUpIcon className="aui-composer-send-icon size-4.5" />
					</ComposerPrimitive.Send>
				) : null}
				{!showPlanFollowupActions && !isConnecting && isRunning ? (
					<ComposerPrimitive.Cancel
						render={
							<Button
								type="button"
								variant="default"
								size="icon"
								className="aui-composer-cancel size-7 rounded-full"
								aria-label="Stop generating"
							/>
						}
					>
						<SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
					</ComposerPrimitive.Cancel>
				) : null}
			</div>
		</div>
	);
};

const CONSIDERING_NEXT_STEPS = "Considering next steps";

const AssistantWorkingIndicator: FC = () => (
	<span
		data-slot="aui_assistant-message-indicator"
		className="text-muted-foreground relative inline-block text-sm leading-none"
		role="status"
		aria-label={CONSIDERING_NEXT_STEPS}
	>
		<span>{CONSIDERING_NEXT_STEPS}</span>
		<span
			aria-hidden
			className="shimmer pointer-events-none absolute inset-0 motion-reduce:animate-none"
		>
			{CONSIDERING_NEXT_STEPS}
		</span>
	</span>
);

const MessageError: FC = () => {
	return (
		<MessagePrimitive.Error>
			<ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
				<ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
			</ErrorPrimitive.Root>
		</MessagePrimitive.Error>
	);
};

const AssistantMessage: FC = () => {
	const { ToolFallback: ToolFallbackComponent = FallbackTool } =
		useContext(ThreadComponentsContext);
	const messageId = useAuiState((s) => s.message.id);
	const planThread = usePlanThreadProjection();
	const hiddenPlanCallIds = getPlanProjectionForMessage(planThread, messageId)?.hiddenCallIds;

	const ACTION_BAR_PT = "pt-1.5";
	// Keep the action bar inside the contained root's paint box, then cancel its reserved space in flow.
	const ACTION_BAR_HEIGHT = `min-h-7.5 ${ACTION_BAR_PT}`;

	return (
		<MessagePrimitive.Root
			data-slot="aui_assistant-message-root"
			data-role="assistant"
			className="fade-in slide-in-from-bottom-1 animate-in relative -mb-7.5 pb-7.5 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto]"
		>
			<div
				data-slot="aui_assistant-message-content"
				className="text-foreground px-2 leading-relaxed wrap-break-word"
			>
				<MessagePrimitive.GroupedParts
					groupBy={(part, context) => {
						if (part.type === "reasoning") {
							return ["group-activity", "group-thinking"] as const;
						}
						if (part.type === "tool-call") {
							if (getMcpAppFromToolPart(part)) return [];
							if (context.toolUIs?.[part.toolName]?.[0]?.standalone) return [];
							if (
								shouldExcludeToolCallFromActivityGroup(part, {
									hiddenPlanCallIds,
								})
							) {
								return [];
							}
							return ["group-activity", getGroupKeyForTool(part.toolName)] as const;
						}
						// Hidden step markers stay in the activity run so they don't fragment groups.
						if (part.type === "data" && isHiddenOpenCodeDataPart(part.name)) {
							return ["group-activity"] as const;
						}
						return [];
					}}
				>
					{({ part, children }) => {
						switch (part.type) {
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
				className={cn("ms-2 flex items-center", ACTION_BAR_HEIGHT)}
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
					<MoreHorizontalIcon />
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
	return (
		<MessagePrimitive.Root
			data-slot="aui_user-message-root"
			className="fade-in slide-in-from-bottom-1 animate-in grid auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [contain-intrinsic-size:auto_200px] [content-visibility:auto] [&:where(>*)]:col-start-2"
			data-role="user"
		>
			<UserMessageAttachments />

			<div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
				<div className="aui-user-message-content border-border/60 bg-background text-foreground dark:border-muted-foreground/15 rounded-xl border px-4 py-2 wrap-break-word empty:hidden">
					<MessagePrimitive.Parts />
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
