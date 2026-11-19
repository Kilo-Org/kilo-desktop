import {
	MessagePrimitive,
	ThreadPrimitive,
	useAuiState,
	type AssistantState,
} from "@assistant-ui/react";
import { useEffect, useRef, type FC, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { usePlanHiddenCallIds } from "../plan/use-plan-thread-projection";
import { createActivityGroupBy, createTurnWorkGroupBy } from "../tools/activity-grouping";
import { SavedLayer } from "../saved/saved-layer";
import { MarkdownText } from "../thread/markdown-text";
import {
	replyBlocks,
	replyTargetNearMiddle,
	revealReplyBlock,
	type ChatFocusTarget,
} from "./chat-focus";
import { useChatReading, useFocusContainer, useFocusSession } from "./chat-reading";
import { PaneFocusRail, PaneReadingControl, replyTargetFromRail } from "./reading-ui";
import { useFocusSource } from "./use-focus-source";

const VIEWPORT = '[data-slot="aui_thread-viewport"]';

const hasReplyText = (state: AssistantState) =>
	state.thread.messages.some(
		(message) =>
			message.role === "assistant" &&
			message.content.some((part) => part.type === "text" && Boolean(part.text.trim())),
	);

/**
 * Reading Mode in an agent pane's transcript: registers the pane with Focus,
 * offers "Focus from here" over reply text and the Aa control above the
 * composer. `column` is the transcript's centred column. Call once per
 * transcript; render its rail, Aa control and `ReplyFocusPortal`.
 */
export function useTranscriptReading(column: HTMLElement | null) {
	const context = useChatReading();
	const hasReply = useAuiState(hasReplyText);
	const isRunning = useAuiState((state) => state.thread.isRunning);
	const viewport = () => column?.closest(VIEWPORT) ?? null;

	useFocusSource({
		kind: "reply",
		available: hasReply,
		targetNearMiddle: () => replyTargetNearMiddle(viewport()),
		reveal: (target) => {
			if (target.kind === "reply") revealReplyBlock(viewport(), target.messageId, target.block);
		},
		entryContext: (target) => entryContext(target),
	});

	const entryContext = (target: ChatFocusTarget) => {
		const message =
			target.kind === "reply"
				? viewport()?.querySelector(`[data-message-id="${CSS.escape(target.messageId)}"]`)
				: null;
		return { blockCount: message ? replyBlocks(message).length : 0, streaming: isRunning };
	};

	const enter = (
		source: "rail" | "reading-control",
		target = replyTargetNearMiddle(viewport()),
	) => {
		if (!context || !target || target.kind !== "reply") return;
		void context.reading.enter(context, target, source, entryContext(target));
	};

	return { available: Boolean(context) && hasReply, enter };
}

export type EnterTranscriptFocus = ReturnType<typeof useTranscriptReading>["enter"];

/** The Aa control above the composer. */
export const TranscriptReadingControl: FC<{ enter: EnterTranscriptFocus; className?: string }> = ({
	enter,
	className,
}) => (
	<PaneReadingControl
		surface="chat"
		base="chat"
		enterFocus={() => enter("reading-control")}
		{...(className ? { className } : {})}
	/>
);

/** "Focus from here" beside the transcript column. */
export const TranscriptFocusRail: FC<{
	column: HTMLElement | null;
	enter: EnterTranscriptFocus;
}> = ({ column, enter }) => (
	<PaneFocusRail
		host={column}
		placement="outside"
		onFocusFrom={(target) => {
			const reply = replyTargetFromRail(target);
			if (reply) enter("rail", reply);
		}}
	/>
);

/**
 * The chat, portalled into the Focus take-over while this pane is being
 * read: every prompt and reply in order, the reader starting on the entered
 * paragraph. Not windowed like the transcript: only text is shown here.
 */
export const ReplyFocusPortal: FC = () => {
	const context = useChatReading();
	const session = useFocusSession(context?.reading);
	const container = useFocusContainer(context?.reading);
	const reading = context?.reading;
	const showFocusToast = (node: ReactNode | null) => reading?.showFocusToast(node);
	const readingChat = session?.paneId === context?.paneId && session?.target.kind === "reply";
	if (!context || !readingChat || !container) return null;
	return createPortal(
		<SavedLayer
			saved={context.reading.saved}
			workSessionId={context.workSessionId}
			chatId={context.chatId}
			root={container}
			surface="focus"
			renderToast={showFocusToast}
			canView
		>
			<ThreadPrimitive.Messages>
				{({ message }) =>
					message.role === "user" ? (
						<FocusPromptMessage />
					) : message.role === "assistant" ? (
						<FocusReplyMessage />
					) : null
				}
			</ThreadPrimitive.Messages>
		</SavedLayer>,
		container,
	);
};

/** Turns sit apart from each other; the gap follows the reading text size. */
const FOCUS_MESSAGE_CLASS = "mt-[calc(var(--focus-block-gap)*2.5)] first:mt-0";

const promptText = (state: AssistantState) =>
	state.message.parts
		.flatMap((part) => (part.type === "text" ? [part.text] : []))
		.join("\n\n")
		.trim();

/**
 * A prompt, as paragraphs Focus moves through like reply text: marked with
 * "You" and a rule, and not a reading surface, so it can't be saved.
 */
const FocusPromptMessage: FC = () => {
	const paragraphs = useAuiState(promptText)
		.split(/\n{2,}/u)
		.filter((paragraph) => paragraph.trim());
	if (paragraphs.length === 0) return null;
	return (
		<MessagePrimitive.Root
			data-qa-id="chat-focus-prompt"
			data-role="user"
			className={cn(FOCUS_MESSAGE_CLASS, "border-border border-s-2 ps-4")}
		>
			<p className="text-muted-foreground mb-1 text-xs font-medium" aria-hidden="true">
				You
			</p>
			<div className="aui-md whitespace-pre-wrap">
				{paragraphs.map((paragraph, index) => (
					<p key={index}>{paragraph}</p>
				))}
			</div>
		</MessagePrimitive.Root>
	);
};

/** A reply's answer text as the transcript shows it: no prompt, tools, reasoning or folded narration. */
const FocusReplyMessage: FC = () => {
	const context = useChatReading();
	const parts = useAuiState((state) => state.message.parts);
	const messageId = useAuiState((state) => state.message.id);
	const running = useAuiState((state) => state.message.status?.type === "running");
	const hiddenPlanCallIds = usePlanHiddenCallIds(messageId);
	const groupBy = running
		? createActivityGroupBy(parts, { hiddenPlanCallIds })
		: createTurnWorkGroupBy(parts, { hiddenPlanCallIds });
	const wasRunning = useRef(running);
	useEffect(() => {
		if (wasRunning.current && !running) context?.reading.noteReplyFinished();
		wasRunning.current = running;
	}, [context, running]);
	return (
		<MessagePrimitive.Root
			data-qa-id="chat-focus-reply"
			data-role="assistant"
			className={cn(FOCUS_MESSAGE_CLASS, "empty:hidden")}
		>
			<MessagePrimitive.GroupedParts indicator="never" groupBy={groupBy}>
				{({ part }) =>
					part.type === "text" ? (
						<div data-reading-surface="reply">
							<MarkdownText />
						</div>
					) : null
				}
			</MessagePrimitive.GroupedParts>
		</MessagePrimitive.Root>
	);
};
