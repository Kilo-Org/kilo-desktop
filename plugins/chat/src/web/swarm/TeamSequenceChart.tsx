import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type { BoardMessage } from "@kilo-desktop/plugin-core/contracts";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { tint } from "./swarm-colors";
import { sequenceArrows, threadIds, type SequenceArrow } from "./team-sequence";
import type { Timeline, TimelineLane } from "./team-timeline";

const LANE_HEIGHT = 48;
/** The chart widens with density; equal timestamps still share a position on the time axis. */
const MIN_PX_PER_POST = 32;
const PAD = 16;

const time = (timestamp: number) =>
	new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** How a post's arrow is drawn: dashed for INFO, heavier for what blocks someone. */
function strokeOf(type: SequenceArrow["type"]): { dash?: string; width: number } {
	switch (type) {
		case "INFO":
			return { dash: "4 3", width: 1.25 };
		case "HOLD":
		case "VETO":
			return { width: 2.25 };
		default:
			return { width: 1.5 };
	}
}

/** The chart area's width in CSS pixels, followed as the pane resizes. */
/**
 * Measures each lane's name row (names wrap, so lanes grow) until the
 * returned cleanup runs. `_lanes` re-runs it when the lanes change.
 */
function observeLaneHeights(
	names: HTMLDivElement | null,
	_lanes: readonly TimelineLane[],
	onHeights: (heights: number[]) => void,
): (() => void) | undefined {
	if (!names) return;
	const measure = () =>
		onHeights(Array.from(names.children, (lane) => lane.getBoundingClientRect().height));
	measure();
	const observer = new ResizeObserver(measure);
	for (const lane of names.children) observer.observe(lane);
	return () => observer.disconnect();
}

function useWidth() {
	const ref = useRef<HTMLDivElement>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		setWidth(element.clientWidth);
		const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return { ref, width };
}

/**
 * The team's activity and conversation on one time axis: a lane per agent with
 * its activity as a bar (to now while it runs; dashed to its last known moment
 * when nothing says when it stopped), and each board post as an arrow from
 * its sender's lane to its recipient's, in the sender's color — dashed for
 * INFO, heavier for HOLD and VETO, a fan of ticks for posts to everyone.
 * Hovering or focusing a post highlights its thread and links its replies;
 * Selecting reveals its full post with an explicit source jump. The axis
 * comes from `timeline`, so it holds still when the supplied posts change.
 */
export function TeamSequenceChart({
	timeline,
	messages,
	mainChatId,
	colorOf,
	nameOf,
	onJump,
	more,
}: {
	readonly timeline: Timeline;
	readonly messages: readonly BoardMessage[];
	readonly mainChatId: string;
	readonly colorOf: (chatId: string) => string;
	readonly nameOf: (id: string, label?: string) => string;
	readonly onJump: (messageId: string) => void;
	/** Older posts exist beyond those loaded. */
	readonly more: boolean;
}) {
	const { ref, width: available } = useWidth();
	const [focused, setFocused] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const detailId = useId();
	const namesRef = useRef<HTMLDivElement>(null);
	const [laneHeights, setLaneHeights] = useState<number[]>([]);
	useEffect(
		() => observeLaneHeights(namesRef.current, timeline.lanes, setLaneHeights),
		[timeline.lanes],
	);
	const arrows = sequenceArrows(timeline, messages, mainChatId);
	const byId = new Map(arrows.map((arrow) => [arrow.id, arrow]));
	const messageById = new Map(messages.map((message) => [message.id, message]));
	const selected = selectedId && byId.has(selectedId) ? messageById.get(selectedId) : undefined;
	const highlightedId = focused && byId.has(focused) ? focused : selected?.id;
	const thread = highlightedId ? threadIds(messages, highlightedId) : null;

	const lanes = timeline.lanes;
	const width = Math.max(available, arrows.length * MIN_PX_PER_POST, 240);
	const heights = lanes.map((_, index) => laneHeights[index] ?? LANE_HEIGHT);
	const height = heights.reduce((total, lane) => total + lane, 0);
	const xOf = (at: number) => PAD + at * (width - PAD * 2);
	const yOf = (lane: number) =>
		heights.slice(0, lane).reduce((total, value) => total + value, 0) + heights[lane]! / 2;

	const describe = (arrow: SequenceArrow) => {
		const message = messageById.get(arrow.id)!;
		const to = arrow.to === "all" ? "everyone" : nameOf(message.to, message.toLabel);
		return `${nameOf(message.from, message.fromLabel)} to ${to}, ${arrow.type}, ${time(arrow.timestamp)}`;
	};

	const onKey = (event: KeyboardEvent, arrow: SequenceArrow) => {
		if (event.key === "Enter" || event.key === " ") {
			event.preventDefault();
			setSelectedId(arrow.id);
		}
	};

	return (
		<div className="flex min-w-0 flex-col gap-3" data-qa-id="swarm-timeline">
			<div className="flex min-w-0">
				<div ref={namesRef} className="w-44 shrink-0">
					{lanes.map((lane) => (
						<div
							key={lane.chatId}
							className="flex min-h-12 items-center gap-2 py-2 pe-3 text-sm"
							data-qa-id="swarm-timeline-lane"
						>
							<span
								aria-hidden
								className="size-2 shrink-0 rounded-full"
								style={{ backgroundColor: colorOf(lane.chatId) }}
							/>
							<span className="min-w-0 [overflow-wrap:anywhere]">{lane.title}</span>
						</div>
					))}
				</div>
				<div ref={ref} className="min-w-0 flex-1 overflow-x-auto">
					<svg
						width={width}
						height={height}
						className="block"
						role="group"
						aria-label="Who posted to whom, over time"
						onMouseLeave={() => setFocused(null)}
					>
						{lanes.map((lane, index) => {
							const color = colorOf(lane.chatId);
							const x = xOf(lane.start);
							const barWidth = Math.max(2, xOf(lane.end) - x);
							return (
								<g key={lane.chatId}>
									<line
										x1={0}
										x2={width}
										y1={yOf(index)}
										y2={yOf(index)}
										className="stroke-border"
										strokeWidth={1}
									/>
									<rect
										x={x}
										y={yOf(index) - 4}
										width={barWidth}
										height={8}
										rx={3}
										fill={lane.ending === "unknown" ? "transparent" : tint(color, 40)}
										stroke={lane.ending === "unknown" ? color : "none"}
										strokeDasharray={lane.ending === "unknown" ? "3 2" : undefined}
										className={cn(
											lane.ending === "running" && "animate-pulse motion-reduce:animate-none",
										)}
										data-qa-id="swarm-timeline-bar"
										data-ending={lane.ending}
									>
										<title>
											{lane.ending === "unknown"
												? "When it stopped isn't known"
												: lane.ending === "running"
													? "Activity continues to now"
													: lane.title}
										</title>
									</rect>
								</g>
							);
						})}

						{thread
							? arrows
									.filter(
										(arrow) => arrow.replyTo && thread.has(arrow.id) && byId.has(arrow.replyTo),
									)
									.map((arrow) => {
										const original = byId.get(arrow.replyTo!)!;
										const x1 = xOf(original.at);
										const y1 = yOf(original.from);
										const x2 = xOf(arrow.at);
										const y2 = yOf(arrow.from);
										const lift = Math.min(LANE_HEIGHT, Math.abs(x2 - x1) / 3) + 6;
										return (
											<path
												key={`reply-${arrow.id}`}
												d={`M ${x1} ${y1} Q ${(x1 + x2) / 2} ${Math.min(y1, y2) - lift} ${x2} ${y2}`}
												fill="none"
												className="stroke-muted-foreground/60"
												strokeWidth={1}
												strokeDasharray="2 2"
												data-qa-id="swarm-timeline-reply"
											/>
										);
									})
							: null}

						{arrows.map((arrow) => {
							const message = messageById.get(arrow.id)!;
							const color = colorOf(message.from === "main" ? mainChatId : message.from);
							const x = xOf(arrow.at);
							const y1 = yOf(arrow.from);
							const dim = thread !== null && !thread.has(arrow.id);
							const stroke = strokeOf(arrow.type);
							const others = lanes.map((_, index) => index).filter((index) => index !== arrow.from);
							return (
								<g
									key={arrow.id}
									role="button"
									tabIndex={0}
									aria-label={describe(arrow)}
									aria-pressed={selected?.id === arrow.id}
									aria-controls={detailId}
									className={cn(
										"cursor-pointer outline-none transition-opacity motion-reduce:transition-none",
										dim && "opacity-25",
									)}
									onClick={() => setSelectedId(arrow.id)}
									onKeyDown={(event) => onKey(event, arrow)}
									onMouseEnter={() => setFocused(arrow.id)}
									onFocus={() => setFocused(arrow.id)}
									onBlur={() => setFocused(null)}
									data-qa-id="swarm-timeline-post"
									data-to={arrow.to === null ? "none" : String(arrow.to)}
								>
									<title>{`${describe(arrow)}\n${message.body.split("\n")[0]}`}</title>
									{typeof arrow.to === "number" ? (
										<>
											<line
												x1={x}
												x2={x}
												y1={y1}
												y2={yOf(arrow.to) + (arrow.to > arrow.from ? -5 : 5)}
												stroke={color}
												strokeWidth={stroke.width}
												strokeDasharray={stroke.dash}
											/>
											<path
												d={
													arrow.to > arrow.from
														? `M ${x - 3.5} ${yOf(arrow.to) - 6} L ${x + 3.5} ${yOf(arrow.to) - 6} L ${x} ${yOf(arrow.to) - 1} Z`
														: `M ${x - 3.5} ${yOf(arrow.to) + 6} L ${x + 3.5} ${yOf(arrow.to) + 6} L ${x} ${yOf(arrow.to) + 1} Z`
												}
												fill={color}
											/>
											{/* A wide, invisible target, so thin arrows are easy to hover. */}
											<line
												x1={x}
												x2={x}
												y1={y1}
												y2={yOf(arrow.to)}
												stroke="transparent"
												strokeWidth={24}
											/>
										</>
									) : arrow.to === "all" ? (
										others.map((index) => (
											<line
												key={index}
												x1={x}
												x2={x}
												y1={yOf(index) - 3}
												y2={yOf(index) + 3}
												stroke={color}
												strokeWidth={1.5}
											/>
										))
									) : null}
									<circle cx={x} cy={y1} r={12} fill="transparent" />
									<circle
										cx={x}
										cy={y1}
										r={3.5}
										fill={color}
										className="stroke-pane"
										strokeWidth={1.5}
									/>
									{focused === arrow.id || selected?.id === arrow.id ? (
										<circle cx={x} cy={y1} r={9} fill="none" stroke={color} strokeWidth={2} />
									) : null}
								</g>
							);
						})}
					</svg>
				</div>
			</div>
			<div className="text-muted-foreground flex justify-between gap-2 ps-44 text-xs tabular-nums">
				<span>{time(timeline.from)}</span>
				<span>{time(timeline.to)}</span>
			</div>
			<div
				className="text-muted-foreground flex flex-col gap-2 text-xs"
				aria-label="Timeline legend"
			>
				<ul className="flex flex-wrap gap-x-4 gap-y-1">
					<li>Bars: activity span</li>
					<li>Dashed bar: end unknown</li>
					<li>Dashed arrow: INFO</li>
					<li>Heavy arrow: HOLD / VETO</li>
					<li>Ticks: to everyone</li>
					<li>Dotted curve: reply</li>
				</ul>
				<p>
					Activity spans use recorded starts, ends, and last known activity, not continuous
					execution.
				</p>
				<p>
					{arrows.length} plotted posts from loaded history
					{more ? "; older posts are not loaded" : ""}. Only senders with a team lane are plotted.
				</p>
			</div>
			<div id={detailId} aria-live="polite">
				{selected ? (
					<section
						className="border-border flex min-w-0 flex-col gap-3 rounded-lg border p-4"
						aria-label="Selected post"
						data-qa-id="swarm-timeline-detail"
					>
						<div className="flex flex-wrap items-center gap-2 text-sm">
							<Badge variant="outline">{selected.type}</Badge>
							<span className="min-w-0 [overflow-wrap:anywhere]">
								{nameOf(selected.from, selected.fromLabel)} to{" "}
								{nameOf(selected.to, selected.toLabel)}
							</span>
							<time
								className="text-muted-foreground text-xs tabular-nums"
								dateTime={new Date(selected.timestamp).toISOString()}
							>
								{time(selected.timestamp)}
							</time>
						</div>
						<p className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">{selected.body}</p>
						<Button
							variant="outline"
							className="self-start"
							data-qa-id="swarm-timeline-source"
							onClick={() => onJump(selected.id)}
						>
							Open source in Activity
						</Button>
					</section>
				) : (
					<p className="text-muted-foreground py-2 text-sm">
						Select a post to read its details and open its source.
					</p>
				)}
			</div>
		</div>
	);
}
