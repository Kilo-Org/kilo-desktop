import { useAuiState, useThreadViewport, type ThreadMessage } from "@assistant-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { ConversationMap, type ConversationMapEntry } from "./conversation-map";

const TITLE_LENGTH = 72;
const PREVIEW_LENGTH = 240;

/**
 * A message scrolled to the top of the viewport lands a fraction of a pixel
 * below it, which would otherwise hand the active tick to the turn before.
 */
const TOP_TOLERANCE = 1;

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * The line a message has to cross to count as the one being read. It sits at
 * the top of the viewport for most of a thread, then slides to the bottom
 * across the final screenful: a message that starts within one viewport height
 * of the end can never reach the top, so a fixed line leaves the last screen's
 * worth of ticks permanently unreachable.
 */
const readingLine = (viewport: HTMLElement) => {
	const rect = viewport.getBoundingClientRect();
	const height = viewport.clientHeight;
	if (height <= 0) return rect.top + TOP_TOLERANCE;

	const remaining = viewport.scrollHeight - height - viewport.scrollTop;
	const descent = Math.min(1, Math.max(0, (height - remaining) / height));
	return rect.top + rect.height * descent + TOP_TOLERANCE;
};

type Gutter = { left: number; right: number };

const NO_GUTTER: Gutter = { left: 0, right: 0 };

/**
 * The space the viewport reserves for its scrollbar. It depends on the OS
 * scrollbar mode — about 11px for classic scrollbars, 0 for macOS overlay
 * scrollbars — so it is measured rather than assumed.
 */
const gutterOf = (viewport: HTMLElement): Gutter => {
	const style = getComputedStyle(viewport);
	const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
	const total = Math.max(0, viewport.offsetWidth - viewport.clientWidth - borders);
	const left = style.scrollbarGutter.includes("both-edges") ? total / 2 : 0;
	return { left, right: total - left };
};

const offsetOf = (element: HTMLElement, viewport: HTMLElement) =>
	element.getBoundingClientRect().top - viewport.getBoundingClientRect().top;

const textOf = (message: ThreadMessage) =>
	message.content
		.map((part) => (part.type === "text" ? part.text : ""))
		.join("\n")
		.trim();

const labelOf = (message: ThreadMessage) => {
	const parts = [...message.content];
	const tools = parts.flatMap((part) => (part.type === "tool-call" ? [part.toolName] : []));
	if (tools.length === 1) return tools[0]!;
	if (tools.length > 1) return `${tools.length} tool calls`;
	if (parts.some((part) => part.type === "reasoning")) return "Reasoning";

	// A composer submission carries its files in `attachments` and leaves
	// `content` empty, so both places decide an attachment-only turn's label.
	const carriers = [...parts, ...(message.attachments ?? [])];
	if (carriers.some((carrier) => carrier.type === "image")) return "Image";
	if (carriers.some((carrier) => carrier.type === "file")) return "File";
	if (carriers.length > 0) return "Attachment";
	return message.role === "user" ? "Message" : "Response";
};

/** Cuts on a word boundary so a title never splits a word. */
const cutAtWord = (text: string, limit: number) => {
	if (text.length <= limit) return text;
	const head = text.slice(0, limit);
	const boundary = head.lastIndexOf(" ");
	return boundary > limit / 2 ? head.slice(0, boundary) : head;
};

const linesOf = (message: ThreadMessage) =>
	textOf(message)
		.split("\n")
		.map((line) => line.replace(/^[\s#>*`-]+/, "").trim())
		.filter(Boolean);

/** A user message and the assistant messages answering it. */
type Turn = {
	head: ThreadMessage;
	members: ThreadMessage[];
};

const groupIntoTurns = (messages: readonly ThreadMessage[]) => {
	const turns: Turn[] = [];
	for (const message of messages) {
		if (message.role !== "user" && message.role !== "assistant") continue;

		const current = turns.at(-1);
		if (message.role === "user" || !current) {
			turns.push({ head: message, members: [message] });
			continue;
		}
		current.members.push(message);
	}
	return turns;
};

const describeTurn = ({ head, members }: Turn): ConversationMapEntry => {
	const lines = linesOf(head);
	const first = lines[0] ?? "";
	const title = cutAtWord(first, TITLE_LENGTH);

	// What the turn asked names it; what it answered is the useful preview, and
	// a turn still being answered falls back to the rest of its own text.
	const answer = members.find((member) => member !== head && textOf(member));
	const preview = (
		answer ? linesOf(answer).join(" ") : [first.slice(title.length), ...lines.slice(1)].join(" ")
	)
		.trim()
		.slice(0, PREVIEW_LENGTH);

	return {
		id: head.id,
		title: title || labelOf(head),
		...(preview ? { preview } : {}),
	};
};

/**
 * The conversation map docked to the thread viewport's edge: one tick per user
 * turn, from the second turn on, that marks the turn being read and those in
 * view and scrolls to a turn when clicked. Hidden in panes too narrow to leave
 * room beside the message column.
 */
export function ConversationMapRail({
	side = "left",
	className,
}: {
	side?: "left" | "right";
	className?: string;
}) {
	const messages = useAuiState((s) => s.thread.messages);
	const viewport = useThreadViewport((s) => s.element.viewport);
	const viewportHeight = useThreadViewport((s) => s.height.viewport);
	const [activeId, setActiveId] = useState<string | undefined>(undefined);
	const [visibleIds, setVisibleIds] = useState<readonly string[]>([]);
	const [gutter, setGutter] = useState<Gutter>(NO_GUTTER);
	const scheduleRef = useRef<(() => void) | undefined>(undefined);

	const turns = useMemo(() => groupIntoTurns(messages), [messages]);
	const entries = useMemo(() => turns.map(describeTurn), [turns]);

	/** Which turn each message belongs to, so a message in view marks its turn. */
	const turnOf = useMemo(() => {
		const owners = new Map<string, string>();
		for (const turn of turns) {
			for (const member of turn.members) owners.set(member.id, turn.head.id);
		}
		return owners;
	}, [turns]);

	const turnOfRef = useRef(turnOf);
	const turnKey = turns.map((turn) => turn.head.id).join(" ");

	useEffect(() => {
		turnOfRef.current = turnOf;
	});

	useEffect(() => {
		if (!viewport) return undefined;

		let frame = 0;
		const measure = () => {
			frame = 0;
			const owners = turnOfRef.current;
			const view = viewport.getBoundingClientRect();
			const line = readingLine(viewport);

			// One pass yields both facts the rail draws: which turn is being read,
			// and which turns the viewport currently holds.
			let current: string | undefined;
			const onScreen: string[] = [];
			for (const element of viewport.querySelectorAll<HTMLElement>("[data-message-id]")) {
				const box = element.getBoundingClientRect();
				if (box.top >= view.bottom) break;

				const id = element.dataset["messageId"];
				const head = id === undefined ? undefined : owners.get(id);
				if (head === undefined) continue;

				if (box.top <= line) current = head;
				if (box.bottom > view.top && !onScreen.includes(head)) onScreen.push(head);
			}

			setActiveId(current ?? owners.values().next().value);
			setVisibleIds((previous) => (sameIds(previous, onScreen) ? previous : onScreen));
		};
		const schedule = () => {
			if (frame) return;
			frame = requestAnimationFrame(measure);
		};

		scheduleRef.current = schedule;
		schedule();
		viewport.addEventListener("scroll", schedule, { passive: true });
		const observer = new ResizeObserver(schedule);
		observer.observe(viewport);

		return () => {
			scheduleRef.current = undefined;
			if (frame) cancelAnimationFrame(frame);
			viewport.removeEventListener("scroll", schedule);
			observer.disconnect();
		};
	}, [viewport]);

	useEffect(() => {
		scheduleRef.current?.();
	}, [turnKey]);

	// Switching between overlay and classic scrollbars resizes the content box,
	// so the observer also catches a gutter that appears or disappears.
	useEffect(() => {
		if (!viewport) return undefined;
		const update = () =>
			setGutter((previous) => {
				const next = gutterOf(viewport);
				return next.left === previous.left && next.right === previous.right ? previous : next;
			});
		update();
		const observer = new ResizeObserver(update);
		observer.observe(viewport);
		return () => observer.disconnect();
	}, [viewport]);

	const select = useCallback(
		(id: string) => {
			if (!viewport) return;
			const element = [...viewport.querySelectorAll<HTMLElement>("[data-message-id]")].find(
				(candidate) => candidate.dataset["messageId"] === id,
			);
			if (!element) return;

			// `scrollIntoView` aligns every scrollable ancestor, which drags the
			// page a thread is embedded in; only this viewport should move.
			viewport.scrollTo({
				top: viewport.scrollTop + offsetOf(element, viewport),
				behavior: "smooth",
			});
		},
		[viewport],
	);

	if (turns.length < 2) return null;

	return (
		<div
			data-slot="conversation-map-rail"
			className={cn(
				"pointer-events-none sticky top-0 z-10 hidden h-0 @min-[54rem]:block",
				className,
			)}
			// Spans the scrollbar gutters so the ticks sit a fixed distance from the
			// pane edge whatever the OS scrollbar mode.
			style={{
				marginLeft: -gutter.left,
				marginRight: -gutter.right,
				width: `calc(100% + ${gutter.left + gutter.right}px)`,
			}}
		>
			<div
				className={cn(
					"pointer-events-auto absolute top-0 px-2 py-10",
					side === "right" ? "right-0" : "left-0",
				)}
				style={{ height: viewportHeight }}
			>
				<ConversationMap
					entries={entries}
					activeId={activeId}
					visibleIds={visibleIds}
					onSelect={select}
					side={side === "right" ? "left" : "right"}
				/>
			</div>
		</div>
	);
}
