import {
	ThreadPrimitive,
	useAuiEvent,
	useAuiState,
	useThreadViewport,
	type AssistantState,
} from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, type FC, type RefObject } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { ComposerHeader } from "../checkpoints/composer-header";
import { Composer } from "../composer/composer";
import { ComposerFooter } from "../composer/composer-footer";
import { OpenCodeComposerInteraction } from "../interactions/opencode-composer-interaction";
import { ConversationMapRail } from "./conversation-map-rail";
import { ThreadMessage } from "./messages";
import { TooltipIconButton } from "./tooltip-icon-button";

import "./composer.css";

/** Chat text size in place of the UI one; prose at 1.5x, the WCAG 1.4.8 minimum. */
const CHAT_TYPOGRAPHY_CLASS =
	"[--app-ui-text-size:var(--app-chat-text-size)] [--leading-relaxed:1.5]";

const THREAD_VIEWPORT_CLASS =
	"relative flex flex-1 flex-col items-center overflow-x-hidden overflow-y-auto scroll-smooth";

// A chat that doesn't exist yet: its composer is focused until the first
// message creates the chat.
const isDraftView = (s: AssistantState) =>
	s.thread.messages.length === 0 && s.threadListItem.status === "new";

/**
 * A session's transcript and composer, over the pane's runtime. A new chat
 * opens as it will look once it has messages, with the composer docked at
 * the bottom; the launcher is where a session is greeted.
 */
const THREAD_HEIGHT_VAR = "--thread-height";

/**
 * Publishes the thread's rendered height as a CSS variable so the composer can
 * cap itself at a share of its own pane (panes split the window, so viewport
 * units would be wrong). Set directly on the element: a resize must not
 * re-render the thread.
 */
function useThreadHeightVariable(ref: RefObject<HTMLDivElement | null>) {
	useLayoutEffect(() => {
		const root = ref.current;
		if (!root) return;
		const publish = () => root.style.setProperty(THREAD_HEIGHT_VAR, `${root.clientHeight}px`);
		publish();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(publish);
		observer.observe(root);
		return () => observer.disconnect();
	}, [ref]);
}

export const Thread: FC = () => {
	const isDraft = useAuiState(isDraftView);
	const rootRef = useRef<HTMLDivElement>(null);
	useThreadHeightVariable(rootRef);

	return (
		<ThreadPrimitive.Root
			ref={rootRef}
			className={cn(
				"aui-root aui-thread-root bg-pane @container flex h-full flex-col",
				CHAT_TYPOGRAPHY_CLASS,
				"[--composer-bg:var(--pane-raised)]",
			)}
			style={{
				["--thread-max-width" as string]: "48rem",
				["--composer-radius" as string]: "1rem",
				["--composer-padding" as string]: "8px",
			}}
			data-qa-id="kilo-chat-thread"
			data-draft={isDraft || undefined}
		>
			<ThreadPrimitive.Viewport
				turnAnchor="bottom"
				autoScroll
				scrollToBottomOnRunStart={false}
				data-slot="aui_thread-viewport"
				className={cn(THREAD_VIEWPORT_CLASS, "[scrollbar-gutter:stable_both-edges]")}
			>
				<ScrollToBottomOnSend />
				{/* A gradient, not a `scroll-fade` mask: masking the scroller disables the
				    docked composer's backdrop blur in Chromium. */}
				<div
					aria-hidden
					className="from-pane pointer-events-none sticky top-0 z-10 -mb-6 h-6 w-full shrink-0 bg-linear-to-b to-transparent"
				/>
				{isDraft ? null : <ConversationMapRail />}
				<div
					data-slot="aui_thread-column"
					className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-1 pt-4"
				>
					<div data-slot="aui_message-group" className="mb-16 flex flex-col gap-y-4 empty:hidden">
						<ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
					</div>
					<ThreadPrimitive.ViewportFooter
						/* Transparent so sticky glass can blur scrolled messages behind the shell. */
						className="aui-thread-viewport-footer relative sticky bottom-0 mt-auto flex flex-col gap-4 overflow-visible rounded-t-(--composer-radius) pb-1.5"
					>
						<ThreadScrollToBottom />
						<div className="relative flex w-full flex-col">
							<ComposerDockMask />
							<ComposerHeader />
							{/* The footer's backdrop reaches up into this gap, not over the composer. */}
							<div className="flex flex-col gap-1.5" data-qa-id="kilo-composer-dock">
								<div className="flex flex-col gap-3">
									<OpenCodeComposerInteraction fallback={<Composer isDraft={isDraft} />} />
								</div>
								<ComposerFooter />
							</div>
						</div>
					</ThreadPrimitive.ViewportFooter>
				</div>
			</ThreadPrimitive.Viewport>
		</ThreadPrimitive.Root>
	);
};

// The fill under the dock is exactly the footer's pb-1.5, so it reaches the
// pane's bottom edge: any taller and it overflows the viewport, which scrolls.
const ComposerDockMask: FC = () => (
	<>
		<div aria-hidden className="bg-pane pointer-events-none absolute -inset-x-4 top-full h-1.5" />
		<div aria-hidden className="composer-corner-fill composer-corner-fill-bl" />
		<div aria-hidden className="composer-corner-fill composer-corner-fill-br" />
	</>
);

const ThreadScrollToBottom: FC = () => (
	<ThreadPrimitive.ScrollToBottom
		render={
			<TooltipIconButton
				tooltip="Scroll to bottom"
				variant="outline"
				className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-muted absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
				data-qa-id="chat-scroll-to-bottom"
			/>
		}
	>
		<ArrowDownIcon />
	</ThreadPrimitive.ScrollToBottom>
);

// Long distances jump instead of gliding: older messages are measured lazily
// (`content-visibility`) and re-rasterize as a scroll crosses them. The scroll
// is reasserted when the run starts so its status rows are included.
const SMOOTH_SCROLL_VIEWPORT_HEIGHTS = 1.5;

/**
 * `composer.send` fires only for sends the person makes; queued prompts that
 * drain on their own never pull the viewport away from someone reading.
 */
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

/** A transcript without a composer (a subagent's), over a readonly thread provider. */
export const ReadonlyThread: FC = () => (
	<ThreadPrimitive.Root
		className={cn(
			"aui-root aui-thread-root bg-pane @container flex h-full min-h-0 flex-col",
			CHAT_TYPOGRAPHY_CLASS,
		)}
		style={{ ["--thread-max-width" as string]: "48rem" }}
		data-qa-id="kilo-readonly-thread"
	>
		<ThreadPrimitive.Viewport
			autoScroll
			turnAnchor="bottom"
			data-slot="aui_readonly-thread-viewport"
			className={cn(THREAD_VIEWPORT_CLASS, "[scrollbar-gutter:stable_both-edges]")}
		>
			<div className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-1 pt-4">
				<div data-slot="aui_message-group" className="flex flex-col gap-y-4 empty:hidden">
					<ThreadPrimitive.Messages>{() => <ThreadMessage />}</ThreadPrimitive.Messages>
				</div>
			</div>
		</ThreadPrimitive.Viewport>
	</ThreadPrimitive.Root>
);
