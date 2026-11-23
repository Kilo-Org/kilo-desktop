import { useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	graphEdges,
	graphLayout,
	type GraphEdge,
	type GraphMember,
	type GraphPost,
} from "./swarm-graph";
import { AgentAvatar } from "./swarm-parts";

const GRAPH_HEIGHT = 260;
/** Half the node badge (AgentAvatar's `md` size). */
const NODE_R = 12;
/** The window handles' resolution: each step is 0.5% of the posts' time span. */
const SLIDER_MAX = 200;
/** Half the window handle's thumb; the track's ends sit this far in. */
const THUMB_R = 8;
const TICKS = 5;
/** A done agent's color. */
const DONE_COLOR = "var(--muted-foreground)";
/** Board numbers shown on an edge before the rest fold into `+n`. */
const LABEL_POSTS = 3;

const clock = (timestamp: number) =>
	new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The area's width in CSS pixels, followed as the pane resizes. */
function useWidth() {
	const [width, setWidth] = useState(0);
	const ref = (element: HTMLDivElement | null) => {
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
		observer.observe(element);
		return () => observer.disconnect();
	};
	return { ref, width };
}

/** What a blocking edge asks for: a veto outweighs a hold. */
function blockingNote(edge: GraphEdge): string | null {
	if (edge.posts.some((post) => post.type === "VETO")) return "Vetoed";
	if (edge.posts.some((post) => post.type === "HOLD")) return "Asked to wait";
	return null;
}

/** A gentle curve from `a` to `b`, with the point halfway along it. */
function curve(a: { x: number; y: number }, b: { x: number; y: number }) {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const length = Math.hypot(dx, dy) || 1;
	const bend = length * 0.12;
	const cx = (a.x + b.x) / 2 - (dy / length) * bend;
	const cy = (a.y + b.y) / 2 + (dx / length) * bend;
	return {
		d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
		mid: { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 },
	};
}

/**
 * Who talked to whom on the board: a node per agent (click filters the board
 * to it, double-click opens it) and a line per pair that exchanged posts,
 * heavier with more posts and bright when it carries a HOLD or VETO. The
 * Timing strip narrows the time window; posts and lines outside it dim.
 */
export function SwarmGraph({
	members,
	posts,
	onFilter,
	onOpen,
}: {
	readonly members: readonly GraphMember[];
	readonly posts: readonly GraphPost[];
	readonly onFilter: (memberId: string) => void;
	readonly onOpen: (memberId: string) => void;
}) {
	const { ref, width } = useWidth();
	const [range, setRange] = useState<readonly [number, number]>([0, SLIDER_MAX]);

	const drawnIds = graphEdges(members, posts).inWindow;
	const drawn = posts.filter((post) => drawnIds.has(post.id));
	const first = Math.min(...drawn.map((post) => post.timestamp));
	const last = Math.max(...drawn.map((post) => post.timestamp));
	const start = first;
	const end = last > first ? last : first + 60_000;
	const fractionOf = (timestamp: number) => (timestamp - start) / (end - start);
	const timeAt = (value: number) => start + (value / SLIDER_MAX) * (end - start);
	const timeWindow = { from: timeAt(range[0]), to: timeAt(range[1]) };
	const full = range[0] === 0 && range[1] === SLIDER_MAX;

	const { edges, inWindow } = graphEdges(members, posts, drawn.length > 0 ? timeWindow : undefined);
	const layout = graphLayout(members, width, GRAPH_HEIGHT);
	const memberById = new Map(members.map((member) => [member.id, member]));
	const nameOf = (id: string) => memberById.get(id)?.name ?? id;
	const colorOf = (id: string) => {
		const member = memberById.get(id);
		return !member || member.done ? DONE_COLOR : member.color;
	};

	const ticks = Array.from({ length: TICKS }, (_, index) => {
		const fraction = index / (TICKS - 1);
		return { fraction, label: clock(start + fraction * (end - start)) };
	}).filter((tick, index, all) => index === 0 || tick.label !== all[index - 1]!.label);

	return (
		<div className="flex min-w-0 flex-col gap-3" data-qa-id="swarm-graph">
			<div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
				<span>
					{count(drawn.length, "post", "posts")} between {count(members.length, "agent", "agents")}
				</span>
				<span>Click an agent to filter the board</span>
			</div>

			<div ref={ref} className="relative w-full overflow-hidden" style={{ height: GRAPH_HEIGHT }}>
				{width > 0 ? (
					<svg
						width={width}
						height={GRAPH_HEIGHT}
						className="absolute inset-0 block"
						role="group"
						aria-label="Who posted to whom"
					>
						{edges.map((edge) => {
							const a = layout.get(edge.a);
							const b = layout.get(edge.b);
							if (!a || !b) return null;
							const { d, mid } = curve(a, b);
							const dimmed = !edge.posts.some((post) => inWindow.has(post.id));
							const shown = edge.posts.slice(0, LABEL_POSTS);
							const more = edge.posts.length - shown.length;
							const note = blockingNote(edge);
							const numbers = edge.posts.map((post) => `#${post.seq}`).join(", ");
							return (
								<g
									key={`${edge.a}:${edge.b}`}
									role="img"
									aria-label={`${nameOf(edge.a)} and ${nameOf(edge.b)}: ${count(edge.posts.length, "post", "posts")} (${numbers})${note ? `, ${note}` : ""}`}
									className={cn(
										"transition-opacity motion-reduce:transition-none",
										dimmed && "opacity-25",
									)}
									data-qa-id="swarm-graph-edge"
									data-edge={`${edge.a}:${edge.b}`}
									data-blocking={edge.blocking}
									data-dimmed={dimmed}
								>
									<path
										d={d}
										fill="none"
										className={edge.blocking ? "stroke-foreground" : "stroke-muted-foreground/50"}
										strokeWidth={Math.min(4, edge.posts.length)}
										strokeLinecap="round"
									/>
									<text
										x={mid.x}
										y={mid.y}
										textAnchor="middle"
										dominantBaseline="middle"
										style={{ whiteSpace: "pre" }}
										className={cn(
											"stroke-pane text-[10px] tabular-nums [paint-order:stroke]",
											edge.blocking ? "fill-foreground" : "fill-muted-foreground",
										)}
										strokeWidth={3}
										data-qa-id="swarm-graph-edge-label"
									>
										{shown.map((post, index) => (
											<tspan key={post.id} opacity={inWindow.has(post.id) ? 1 : 0.4}>
												{`${index > 0 ? " " : ""}#${post.seq}`}
											</tspan>
										))}
										{more > 0 ? ` +${more}` : null}
										{note ? ` · ${note}` : null}
									</text>
								</g>
							);
						})}
					</svg>
				) : null}

				{width > 0
					? members.map((member) => {
							const point = layout.get(member.id);
							if (!point) return null;
							const leftward = point.x < width / 2 - 1;
							const room = (leftward ? point.x : width - point.x) - NODE_R - 10;
							return (
								<button
									key={member.id}
									type="button"
									aria-label={`Filter the board to ${member.name}`}
									title={member.name}
									className={cn(
										"focus-visible:ring-ring absolute flex cursor-pointer items-center gap-1.5 rounded-full outline-none focus-visible:ring-2",
										leftward && "flex-row-reverse",
									)}
									style={{
										top: point.y - NODE_R,
										...(leftward
											? { right: width - point.x - NODE_R }
											: { left: point.x - NODE_R }),
									}}
									onClick={() => onFilter(member.id)}
									onDoubleClick={() => onOpen(member.id)}
									data-qa-id="swarm-graph-node"
									data-member-id={member.id}
									data-done={member.done}
								>
									{/* An opaque backing, so lines don't show through the badge's tint. */}
									<span className="bg-pane rounded-full">
										<AgentAvatar name={member.name} color={colorOf(member.id)} />
									</span>
									<span
										className={cn(
											"truncate pe-1 text-xs",
											member.done ? "text-muted-foreground" : "text-foreground",
										)}
										style={{ maxWidth: Math.max(40, room) }}
									>
										{member.name}
									</span>
								</button>
							);
						})
					: null}
			</div>

			{drawn.length === 0 ? (
				<p className="text-muted-foreground text-sm">No posts yet — lines appear as agents talk.</p>
			) : (
				<section
					className="flex min-w-0 flex-col gap-2"
					aria-label="Timing"
					data-qa-id="swarm-graph-timing"
				>
					<div className="flex min-w-0 items-center gap-3 text-xs">
						<span className="font-medium">Timing</span>
						<span
							className="text-muted-foreground min-w-0 flex-1 tabular-nums"
							aria-live="polite"
							data-qa-id="swarm-graph-window"
						>
							Showing {clock(timeWindow.from)} – {clock(timeWindow.to)} · {inWindow.size} of{" "}
							{count(drawn.length, "post", "posts")}
						</span>
						<Button
							variant="ghost"
							size="xs"
							disabled={full}
							onClick={() => setRange([0, SLIDER_MAX])}
							data-qa-id="swarm-graph-reset"
						>
							Reset
						</Button>
					</div>
					<div className="relative h-6">
						<div
							aria-hidden
							className="bg-muted absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
							style={{ left: THUMB_R, right: THUMB_R }}
						/>
						<div
							aria-hidden
							className="absolute inset-y-0"
							style={{ left: THUMB_R, right: THUMB_R }}
						>
							<div
								className="bg-muted-foreground/40 absolute top-1/2 h-1 -translate-y-1/2 rounded-full"
								style={{
									left: `${(range[0] / SLIDER_MAX) * 100}%`,
									width: `${((range[1] - range[0]) / SLIDER_MAX) * 100}%`,
								}}
							/>
							{drawn.map((post) => (
								<span
									key={post.id}
									className={cn(
										"ring-pane absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 transition-opacity motion-reduce:transition-none",
										!inWindow.has(post.id) && "opacity-25",
									)}
									style={{
										left: `${fractionOf(post.timestamp) * 100}%`,
										backgroundColor: colorOf(post.from),
									}}
									data-qa-id="swarm-graph-dot"
									data-in-window={inWindow.has(post.id)}
								/>
							))}
						</div>
						<WindowHandle
							label="Window start"
							value={range[0]}
							valueText={clock(timeWindow.from)}
							raised={range[0] > SLIDER_MAX / 2}
							onChange={(value) => setRange(([, to]) => [Math.min(value, to), to])}
						/>
						<WindowHandle
							label="Window end"
							value={range[1]}
							valueText={clock(timeWindow.to)}
							raised={false}
							onChange={(value) => setRange(([from]) => [from, Math.max(value, from)])}
						/>
					</div>
					<div
						aria-hidden
						className="text-muted-foreground relative h-4 text-xs tabular-nums"
						style={{ marginInline: THUMB_R }}
					>
						{ticks.map((tick) => (
							<span
								key={tick.fraction}
								className="absolute top-0 whitespace-nowrap"
								style={{
									left: `${tick.fraction * 100}%`,
									transform: `translateX(-${tick.fraction * 100}%)`,
								}}
							>
								{tick.label}
							</span>
						))}
					</div>
				</section>
			)}

			<p className="text-muted-foreground text-xs">
				Line weight = number of posts · Bright line = blocking (hold / veto) · Dimmed = outside the
				time window · Colour = working · grey = done
			</p>
		</div>
	);
}

/**
 * One end of the time window: a native range input laid over the track, so
 * it drags, takes arrow keys and reads out its time. Only its thumb takes the
 * pointer, letting the other handle's thumb be grabbed through it.
 */
function WindowHandle({
	label,
	value,
	valueText,
	raised,
	onChange,
}: {
	readonly label: string;
	readonly value: number;
	readonly valueText: string;
	/** Above the other handle, so a start pushed to the end can still be pulled back. */
	readonly raised: boolean;
	readonly onChange: (value: number) => void;
}) {
	return (
		<input
			type="range"
			min={0}
			max={SLIDER_MAX}
			step={1}
			value={value}
			aria-label={label}
			aria-valuetext={valueText}
			onChange={(event) => onChange(Number(event.target.value))}
			className={cn(
				"pointer-events-none absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none bg-transparent outline-none",
				"[&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:ring-pane [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:ring-2",
				"[&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0",
				"focus-visible:[&::-webkit-slider-thumb]:ring-ring focus-visible:[&::-moz-range-thumb]:ring-ring focus-visible:[&::-moz-range-thumb]:ring-2",
				raised && "z-10",
			)}
		/>
	);
}
