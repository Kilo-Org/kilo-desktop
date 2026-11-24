import {
	ThreadPrimitive,
	useAuiEvent,
	useAuiState,
	useThreadViewport,
	type AssistantState,
} from "@assistant-ui/react";
import { ArrowDownIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type FC, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useFindScopeOpen } from "@kilo-desktop/ui/components/find-bar";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { ComposerHeader } from "../checkpoints/composer-header";
import { Composer } from "../composer/composer";
import { ComposerFooter } from "../composer/composer-footer";
import { OpenCodeComposerInteraction } from "../interactions/opencode-composer-interaction";
import { ManualDisclosureMemoryProvider } from "../tools/activity-group";
import { ConversationMapRail } from "./conversation-map-rail";
import { WindowedMessages } from "./message-window";
import { ThreadMessage } from "./messages";
import { OlderHistoryStatus } from "./older-history-status";
import { TooltipIconButton } from "./tooltip-icon-button";
import { TurnErrorStatus } from "./turn-error-status";

import "./composer.css";

/** Chat text size in place of the UI one; prose at 1.5x, the WCAG 1.4.8 minimum. */
const CHAT_TYPOGRAPHY_CLASS =
	"[--app-ui-text-size:var(--app-chat-text-size)] [--leading-relaxed:1.5]";

/**
 * Block layout, not a flex column: a streamed token grows the last message,
 * and a flex container lays out every one of its children again, the
 * windowing's placeholders included, so each token's layout cost grew with
 * the session's length. Block layout leaves the messages above untouched.
 */
const MESSAGE_GROUP_CLASS = "space-y-4 empty:hidden";

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

const COMPOSER_INSET_VAR = "--composer-inset";

/**
 * Publishes the docked composer's height so the transcript reserves that much
 * space at its end; the composer floats over the scroller rather than in it.
 */
function useComposerInsetVariable(
	rootRef: RefObject<HTMLDivElement | null>,
	dock: HTMLDivElement | null,
) {
	useLayoutEffect(() => {
		const root = rootRef.current;
		if (!root || !dock) return;
		const publish = () => root.style.setProperty(COMPOSER_INSET_VAR, `${dock.offsetHeight}px`);
		publish();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(publish);
		observer.observe(dock);
		return () => observer.disconnect();
	}, [rootRef, dock]);
}

const SCROLLBAR_GUTTER_VAR = "--transcript-scrollbar-gutter";

/**
 * Publishes the width of each of the transcript's scrollbar gutters so the
 * dock can stop short of them: it floats over the scroller, so at full pane
 * width it covered the scrollbar's lower end, where the thumb sits while the
 * reader is at the bottom.
 */
function useScrollbarGutterVariable(
	rootRef: RefObject<HTMLDivElement | null>,
	viewportRef: RefObject<HTMLDivElement | null>,
) {
	useLayoutEffect(() => {
		const root = rootRef.current;
		const viewport = viewportRef.current;
		if (!root || !viewport) return;
		const publish = () => {
			// Both edges reserve a gutter (scrollbar-gutter: stable both-edges).
			const gutter = (viewport.offsetWidth - viewport.clientWidth) / 2;
			root.style.setProperty(SCROLLBAR_GUTTER_VAR, `${gutter}px`);
		};
		publish();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(publish);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [rootRef, viewportRef]);
}

export const Thread: FC = () => {
	const isDraft = useAuiState(isDraftView);
	const rootRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const [dock, setDock] = useState<HTMLDivElement | null>(null);
	useThreadHeightVariable(rootRef);
	useComposerInsetVariable(rootRef, dock);
	useScrollbarGutterVariable(rootRef, viewportRef);

	return (
		<ThreadPrimitive.Root
			ref={rootRef}
			className={cn(
				"aui-root aui-thread-root bg-pane @container relative flex h-full flex-col",
				CHAT_TYPOGRAPHY_CLASS,
				"[--composer-bg:var(--pane-raised)]",
				// A backdrop root: the composer glass blurs only this opaque pane. Reaching
				// the vibrant (transparent) macOS window behind it made the glass flicker.
				"will-change-[filter]",
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
				ref={viewportRef}
				turnAnchor="bottom"
				autoScroll
				scrollToBottomOnRunStart={false}
				data-slot="aui_thread-viewport"
				className={cn(THREAD_VIEWPORT_CLASS, "[scrollbar-gutter:stable_both-edges]")}
			>
				<ScrollToBottomOnSend />
				<div
					aria-hidden
					className="from-pane pointer-events-none sticky top-0 z-10 -mb-6 h-6 w-full shrink-0 bg-linear-to-b to-transparent"
				/>
				{isDraft ? null : <ConversationMapRail />}
				<div
					data-slot="aui_thread-column"
					className="mx-auto flex w-full max-w-(--thread-max-width) flex-1 flex-col px-1 pt-4"
				>
					<div data-slot="aui_message-group" className={cn("mb-16", MESSAGE_GROUP_CLASS)}>
						<TranscriptMessages />
					</div>
					<div aria-hidden className="h-(--composer-inset) shrink-0" />
				</div>
				{/* Not ThreadPrimitive.ViewportFooter: autoscroll counts the footer's height as
				    still at the bottom, so a reader scrolling up less than that is pulled back by
				    the next streamed token.
				    Portaled out of the scroller (keeping the viewport's context) so the glass
				    sits over it like t3code's: a sticky backdrop-filter inside the scroller
				    flickers on macOS while it scrolls. */}
				{dock
					? createPortal(
							<div className="aui-thread-viewport-footer pointer-events-auto relative flex w-full max-w-(--thread-max-width) flex-col gap-4 px-1 pb-1.5">
								<ThreadScrollToBottom />
								<div className="relative flex w-full flex-col">
									<ComposerDockMask />
									<ComposerHeader />
									<div className="flex flex-col" data-qa-id="kilo-composer-dock">
										<div className="relative flex flex-col gap-3">
											<OpenCodeComposerInteraction fallback={<Composer isDraft={isDraft} />} />
											<ComposerCornerFills />
										</div>
										{/* Padding, not a gap: the transcript scrolls under the dock and showed through. */}
										<div className="bg-pane -mx-4 px-4 pt-1.5">
											<ComposerFooter />
										</div>
									</div>
								</div>
							</div>,
							dock,
						)
					: null}
			</ThreadPrimitive.Viewport>
			<div
				ref={setDock}
				// Clear of the scrollbar gutters, and clipped across so the full-bleed pane fills stop there too.
				className="pointer-events-none absolute inset-x-[var(--transcript-scrollbar-gutter,0px)] bottom-0 z-20 flex justify-center overflow-x-clip"
			/>
		</ThreadPrimitive.Root>
	);
};

/**
 * The transcript's messages, windowed to those near the viewport (see
 * message-window.tsx); all of them while the find bar searches.
 */
const TranscriptMessages: FC = () => (
	<ManualDisclosureMemoryProvider>
		<OlderHistoryStatus />
		<WindowedMessages Message={ThreadMessage} disabled={useFindScopeOpen()} />
		<TurnErrorStatus />
	</ManualDisclosureMemoryProvider>
);

// The fill under the dock is exactly the footer's pb-1.5, so it reaches the
// pane's bottom edge without overflowing it.
const ComposerDockMask: FC = () => (
	<div aria-hidden className="bg-pane pointer-events-none absolute -inset-x-4 top-full h-1.5" />
);

// Pane fills the transcript scrolls under: outside the composer's rounded bottom corners, and a
// thin strip behind its bottom edge, where the glass blur repeats its last row of pixels and
// text there streaks through instead of blurring away.
const ComposerCornerFills: FC = () => (
	<>
		<div
			aria-hidden
			className="bg-pane pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-1"
		/>
		<div aria-hidden className="composer-corner-fill composer-corner-fill-bl" />
		<div aria-hidden className="composer-corner-fill composer-corner-fill-br" />
	</>
);

// Long distances jump instead of gliding: the messages a long glide crosses
// mount and are measured as it passes (windowing), and
// every height change restarts the smooth scroll toward the new bottom, so it
// stutters all the way down.
const SMOOTH_SCROLL_VIEWPORT_HEIGHTS = 1.5;

const scrollToBottomBehavior = (viewport: HTMLElement | null): ScrollBehavior => {
	if (!viewport) return "smooth";
	const distance = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
	return distance > viewport.clientHeight * SMOOTH_SCROLL_VIEWPORT_HEIGHTS ? "instant" : "smooth";
};

const ThreadScrollToBottom: FC = () => {
	const isAtBottom = useThreadViewport((s) => s.isAtBottom);
	const scrollToBottom = useThreadViewport((s) => s.scrollToBottom);
	const viewport = useThreadViewport((s) => s.element.viewport);
	return (
		<TooltipIconButton
			tooltip="Scroll to bottom"
			variant="outline"
			className="aui-thread-scroll-to-bottom dark:border-border dark:bg-background dark:hover:bg-muted absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible"
			data-qa-id="chat-scroll-to-bottom"
			disabled={isAtBottom}
			onClick={() => scrollToBottom({ behavior: scrollToBottomBehavior(viewport) })}
		>
			<ArrowDownIcon />
		</TooltipIconButton>
	);
};

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
		// The scroll is reasserted when the run starts so its status rows are included.
		const behavior = scrollToBottomBehavior(viewport);
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
				<div data-slot="aui_message-group" className={MESSAGE_GROUP_CLASS}>
					<TranscriptMessages />
				</div>
			</div>
		</ThreadPrimitive.Viewport>
	</ThreadPrimitive.Root>
);
