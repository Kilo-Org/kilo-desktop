import { useActionBarCopy } from "@assistant-ui/core/react";
import {
	ActionBarMorePrimitive,
	ActionBarPrimitive,
	AuiIf,
	BranchPickerPrimitive,
	ErrorPrimitive,
	MessagePrimitive,
	useAui,
	useAuiState,
} from "@assistant-ui/react";
import {
	CheckIcon,
	ChevronDownIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	CircleCheckIcon,
	CopyIcon,
	DownloadIcon,
	EllipsisIcon,
} from "lucide-react";
import {
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type FC,
	type PropsWithChildren,
} from "react";

import type { DomainObjectState } from "@kilo-desktop/kernel";
import { useDomainObjectState } from "@kilo-desktop/kernel/web";
import { KiloAccount } from "@kilo-desktop/plugin-core/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@kilo-desktop/ui/components/collapsible";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import {
	MENU_SIDE_OFFSET,
	menuRow,
	menuSurface,
	menuWidth,
} from "@kilo-desktop/ui/lib/menu-styles";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { useIsAfterPendingBoundary } from "../checkpoints/checkpoint-revert";
import { retryFailedPrompt } from "../checkpoints/retry-failed-prompt";
import { retryFailedTurn } from "../checkpoints/retry-failed-turn";
import { useRevertPending } from "../checkpoints/revert-pending";
import { RevertToHereButton } from "../checkpoints/revert-to-here-button";
import {
	AssistantImagePart,
	FoldHoistedParts,
	ToolImageAttachments,
	TurnSavedImages,
} from "../media/message-media";
import { usePendingInteractions } from "../interactions/PendingInteractionsContext";
import { useChatConnection } from "../runtime/chat-connection";
import { usePlanHiddenCallIds, usePlanReady } from "../plan/use-plan-thread-projection";
import { useOptionalOpenCodeSession } from "../runtime/use-optional-opencode-runtime-extras";
import { useOptionalChatModelSelection } from "../selection/ChatModelSelectionContext";
import { isKiloGatewayProvider } from "../selection/model-catalog";
import { useKiloSignIn } from "../selection/use-kilo-sign-in";
import { useDelegationRevealNonce } from "../subagents/delegation-reveal-store";
import { useSubagentActivity } from "../subagents/SubagentActivityContext";
import {
	ActivityGroup,
	ActivitySubgroup,
	ManualDisclosureProvider,
	useHasOpenManualDisclosure,
} from "../tools/activity-group";
import {
	DELEGATION_GROUP_PREFIX,
	createActivityGroupBy,
	createTurnWorkGroupBy,
} from "../tools/activity-grouping";
import { DelegationGroup } from "../tools/delegation-group";
import { activityKindFromGroupKey, isDelegationTool } from "../tools/tool-categories";
import { ToolCallSignInGate } from "../tools/tool-sign-in-card";
import { ToolCallFallback } from "../tools/tool-ui-inline";
import { TurnWorkFoldContext } from "../tools/turn-work-fold-context";
import {
	assistantWorkingIndicatorMode,
	messageHasInFlightActivity,
	openCodeTextIsStreaming,
} from "./assistant-working-indicator-mode";
import { UserMessageAttachments } from "./attachment";
import { displayChatError, isKiloSignInError, messageErrorText } from "./chat-error";
import { ReplyTextSurface } from "../reading/reading-ui";
import { BookmarkButton } from "../saved/BookmarkButton";
import { MarkdownText } from "./markdown-text";
import { Reasoning } from "./reasoning";
import { TooltipIconButton } from "./tooltip-icon-button";
import { useShellCopyText } from "./use-shell-copy-text";
import {
	AssistantWorkingIndicator,
	formatTurnDuration,
	TurnWorkHeader,
	useTurnStartedAt,
} from "./working-indicator";

// The current turn and its preceding response stay measurable so the intrinsic
// size used for older messages cannot distort their visual grouping.
const useVirtualizeMessage = () =>
	useAuiState((s) => s.message.index < s.thread.messages.length - 3);

export const ThreadMessage: FC = () => {
	const role = useAuiState((s) => s.message.role);
	return role === "user" ? <UserMessage /> : <AssistantMessage />;
};

const MessageCopyButton: FC = () => {
	const copyToClipboard = useShellCopyText();
	const { copy, disabled } = useActionBarCopy({ copyToClipboard });
	return (
		<TooltipIconButton
			tooltip="Copy"
			disabled={disabled}
			onClick={copy}
			data-qa-id="chat-message-copy"
		>
			<AuiIf condition={(s) => s.message.isCopied}>
				<CheckIcon className="animate-in zoom-in-50 fade-in size-3.5 duration-200 ease-out" />
			</AuiIf>
			<AuiIf condition={(s) => !s.message.isCopied}>
				<CopyIcon className="animate-in zoom-in-75 fade-in size-3.5 duration-150" />
			</AuiIf>
		</TooltipIconButton>
	);
};

const MessageError: FC = () => (
	<MessagePrimitive.Error>
		<KiloMessageErrorBanner />
	</MessagePrimitive.Error>
);

const selectAuthenticated = (state: DomainObjectState<typeof KiloAccount>) => state.signedIn;
const selectConnectionUnavailable = (state: DomainObjectState<typeof KiloAccount>) =>
	state.connection === "unavailable";
const selectSigningIn = (state: DomainObjectState<typeof KiloAccount>) =>
	state.deviceSignIn.status === "initiating" || state.deviceSignIn.status === "waiting";

/**
 * A turn's error. A Kilo Gateway model refused while signed out offers
 * Connect; once signed in, the refused prompt can be retried in place.
 */
const KiloMessageErrorBanner: FC = () => {
	const aui = useAui();
	const session = useOptionalOpenCodeSession() ?? null;
	const { connection } = useChatConnection();
	const model = useOptionalChatModelSelection()?.model;
	const authenticated = useDomainObjectState(KiloAccount, selectAuthenticated) ?? null;
	const connectionUnavailable =
		useDomainObjectState(KiloAccount, selectConnectionUnavailable) ?? true;
	const signingIn = useDomainObjectState(KiloAccount, selectSigningIn) ?? false;
	const { signIn } = useKiloSignIn();
	const errorText = useAuiState((s) => messageErrorText(s.message.status));
	const isLast = useAuiState((s) => s.message.isLast);
	const isKiloModel = model !== undefined && isKiloGatewayProvider({ id: model.providerID });
	const offerSignIn = isKiloModel && !connectionUnavailable && authenticated === false;
	const signedIn = authenticated === true && isKiloSignInError(errorText);
	const retrying = useRef(false);

	const retry = () => {
		if (retrying.current) return;
		retrying.current = true;
		const thread = aui.thread();
		void retryFailedPrompt({
			messages: thread.getState().messages,
			assistantId: aui.message().getState().id,
			...(session && connection
				? {
						retry: (userMessageId: string) =>
							retryFailedTurn({
								connection,
								sessionID: session.id,
								directory: session.directory,
								messageID: userMessageId,
								...(model ? { model } : {}),
							}),
					}
				: {}),
			append: (text: string) => {
				thread.append(text);
			},
		})
			.catch(() => {
				toast.error("Could not retry the prompt");
			})
			.finally(() => {
				retrying.current = false;
			});
	};

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
					<Button type="button" size="sm" onClick={retry} data-qa-id="kilo-message-error-retry">
						Retry
					</Button>
				) : null}
			</div>
		);
	}

	return (
		<ErrorPrimitive.Root
			className="aui-message-error-root border-border bg-background mt-2 flex items-center justify-between gap-3 rounded-md border p-3 text-sm"
			data-qa-id="chat-message-error"
		>
			<span className="aui-message-error-message text-destructive line-clamp-2 min-w-0 flex-1">
				{displayChatError(errorText)}
			</span>
			{offerSignIn ? (
				<Button
					type="button"
					size="sm"
					variant="outline"
					onClick={signIn}
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

/** A settled turn's work, folded under "Worked for 12s" above its final reply. */
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
				<span>{turnSummaryLabel(interrupted, duration)}</span>
				{open ? (
					<ChevronDownIcon aria-hidden className="size-3.5" />
				) : (
					<ChevronRightIcon aria-hidden className="size-3.5" />
				)}
			</CollapsibleTrigger>
			<CollapsibleContent className="h-(--collapsible-panel-height) overflow-hidden transition-[height] duration-200 ease-[cubic-bezier(0.32,0.72,0,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 motion-reduce:transition-none">
				<div className="pt-2 [&>[data-slot=activity-group]:last-child]:mb-0">
					<TurnWorkFoldContext.Provider value>{children}</TurnWorkFoldContext.Provider>
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
};

const AssistantMessage: FC = () => {
	const messageParts = useAuiState((s) => s.message.parts);
	const messageId = useAuiState((s) => s.message.id);
	const hiddenPlanCallIds = usePlanHiddenCallIds(messageId);
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
				((part.type === "text" || part.type === "reasoning") && Boolean(part.text.trim())) ||
				part.type === "tool-call" ||
				part.type === "image",
		),
	);
	const status = useAuiState((s) => s.message.status);
	const turnStartedAt = useTurnStartedAt();
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
	// A ready plan ended its turn. Kilo keeps the chat busy through the follow-up
	// and the answer's hand-off, but that run belongs to the next message.
	const planTurnEnded = usePlanReady(messageId);
	const isRunning =
		status?.type === "running" ||
		(threadOwnsRun && !planTurnEnded) ||
		(isLastMessage && hasActiveSubagents);
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
	const dimmed = useIsAfterPendingBoundary(useRevertPending().pendingId);

	return (
		<MessagePrimitive.Root
			data-slot="aui_assistant-message-root"
			data-role="assistant"
			className={cn(
				"fade-in slide-in-from-bottom-1 animate-in relative -mb-7.5 pb-7.5 transition-opacity duration-150",
				virtualize && "[contain-intrinsic-size:auto_200px] [content-visibility:auto]",
				dimmed ? "pointer-events-none opacity-50" : undefined,
			)}
		>
			<ManualDisclosureProvider scope={messageId}>
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
										<>
											<TurnWorkDisclosure
												animateCollapse={animateWorkCollapse}
												revealNonce={delegationRevealNonce}
												duration={duration}
												interrupted={interrupted}
												onPresenceChange={setHasTurnWorkFold}
											>
												{children}
											</TurnWorkDisclosure>
											{"indices" in part ? (
												<FoldHoistedParts
													parts={part.indices.map((index) => messageParts[index]!)}
												/>
											) : null}
										</>
									);
								case "group-activity":
									return <ActivityGroup group={part}>{children}</ActivityGroup>;
								case "text":
									return (
										<ReplyTextSurface>
											<MarkdownText />
										</ReplyTextSurface>
									);
								case "reasoning":
									return <Reasoning {...part} />;
								case "tool-call":
									return (
										<>
											<ToolCallSignInGate
												toolCallId={part.toolCallId}
												toolName={part.toolName}
												result={part.result}
												isError={part.isError}
											>
												{part.toolUI ?? <ToolCallFallback {...part} />}
											</ToolCallSignInGate>
											<ToolImageAttachments toolCallId={part.toolCallId} />
										</>
									);
								case "image":
									return <AssistantImagePart image={part.image} filename={part.filename} />;
								case "data":
									return part.dataRendererUI;
								default: {
									if (part.type.startsWith("group-") && "indices" in part) {
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
					<TurnSavedImages />
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
					className="ms-2 mt-3 flex min-h-7.5 items-center pt-1.5"
				>
					<BranchPicker />
					<AssistantActionBar hidden={isRunning} />
				</div>
			</ManualDisclosureProvider>
		</MessagePrimitive.Root>
	);
};

const AssistantActionBar: FC<{ hidden: boolean }> = ({ hidden }) => (
	<ActionBarPrimitive.Root
		hideWhenRunning
		autohide="not-last"
		aria-hidden={hidden || undefined}
		className={cn(
			"aui-assistant-action-bar-root text-muted-foreground -ms-1 flex gap-1 transition-opacity duration-200",
			hidden ? "pointer-events-none opacity-0" : "opacity-100",
		)}
	>
		<MessageCopyButton />
		<BookmarkButton />
		<ActionBarMorePrimitive.Root>
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
			<ActionBarMorePrimitive.Content
				side="bottom"
				align="start"
				sideOffset={MENU_SIDE_OFFSET}
				className={cn(
					"aui-action-bar-more-content data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 z-50 overflow-hidden p-1",
					menuSurface,
					menuWidth.default,
				)}
			>
				<ActionBarPrimitive.ExportMarkdown
					render={
						<ActionBarMorePrimitive.Item
							className={cn(
								"aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
								menuRow,
							)}
						/>
					}
				>
					<DownloadIcon />
					Export as Markdown
				</ActionBarPrimitive.ExportMarkdown>
			</ActionBarMorePrimitive.Content>
		</ActionBarMorePrimitive.Root>
	</ActionBarPrimitive.Root>
);

const UserActionBar: FC = () => {
	// Stays in the DOM so the bubble never reflows; hover fades it in.
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
	const dimmed = useIsAfterPendingBoundary(useRevertPending().pendingId);
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
					<MessagePrimitive.Parts />
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

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({ className, ...rest }) => (
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
