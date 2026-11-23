import { CheckIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	graphEdges,
	graphHub,
	graphLayout,
	type GraphEdge,
	type GraphMember,
	type GraphPost,
} from "./swarm-graph";
import { AgentAvatar } from "./swarm-parts";

const GRAPH_HEIGHT = 320;
/** The window handles' resolution: each step is 0.5% of the axis. */
const SLIDER_MAX = 200;
/** Half the window handle; the track's ends sit this far in. */
const THUMB_R = 4;
/** Tick spacings to choose from, in minutes: the smallest giving at most six ticks. */
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 240];
const MINUTE = 60_000;
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

/**
 * A line from `a` to `b`: straight through the middle of the graph, bowing
 * outward round its rim (as an ellipse's edge does), with its midpoint.
 */
function curve(
	a: { x: number; y: number },
	b: { x: number; y: number },
	centre: { x: number; y: number },
) {
	const mx = (a.x + b.x) / 2;
	const my = (a.y + b.y) / 2;
	const ox = mx - centre.x;
	const oy = my - centre.y;
	const away = Math.hypot(ox, oy);
	const length = Math.hypot(b.x - a.x, b.y - a.y);
	if (away < 24 || length === 0)
		return { d: `M ${a.x} ${a.y} L ${b.x} ${b.y}`, mid: { x: mx, y: my } };
	const bend = length * 0.22;
	const cx = mx + (ox / away) * bend;
	const cy = my + (oy / away) * bend;
	return {
		d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`,
		mid: { x: (a.x + 2 * cx + b.x) / 4, y: (a.y + 2 * cy + b.y) / 4 },
	};
}

/** The axis: whole minutes round the posts, ticked every 1, 2, 5… minutes. */
function timeAxis(first: number, last: number) {
	if (!Number.isFinite(first) || !Number.isFinite(last))
		return { start: 0, end: MINUTE, ticks: [] };
	let start = Math.floor(first / MINUTE) * MINUTE;
	let end = Math.ceil(last / MINUTE) * MINUTE;
	if (end <= start) end = start + MINUTE;
	const minutes = (end - start) / MINUTE;
	const step = (TICK_STEPS.find((candidate) => minutes / candidate <= 5) ?? 480) * MINUTE;
	start = Math.floor(start / step) * step;
	end = Math.ceil(end / step) * step;
	const ticks: number[] = [];
	for (let at = start; at <= end; at += step) ticks.push(at);
	return { start, end, ticks };
}

/**
 * Who talked to whom on the board: a node per agent (click filters the board
 * to it, double-click opens it) and a line per pair that exchanged posts,
 * heavier with more posts and bright when it carries a HOLD or VETO. The
 * Timing strip narrows the time window; lines outside it turn dashed.
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
	const axis = timeAxis(
		Math.min(...drawn.map((post) => post.timestamp)),
		Math.max(...drawn.map((post) => post.timestamp)),
	);
	const { start, end } = axis;
	const fractionOf = (timestamp: number) => (timestamp - start) / (end - start);
	const timeAt = (value: number) => start + (value / SLIDER_MAX) * (end - start);
	const timeWindow = { from: timeAt(range[0]), to: timeAt(range[1]) };
	const full = range[0] === 0 && range[1] === SLIDER_MAX;

	const { edges, inWindow } = graphEdges(members, posts, drawn.length > 0 ? timeWindow : undefined);
	const layout = graphLayout(members, width, GRAPH_HEIGHT, graphHub(members, edges));
	const centre = { x: width / 2, y: GRAPH_HEIGHT / 2 };
	const memberById = new Map(members.map((member) => [member.id, member]));
	const nameOf = (id: string) => memberById.get(id)?.name ?? id;
	const colorOf = (id: string) => {
		const member = memberById.get(id);
		return !member || member.done ? DONE_COLOR : member.color;
	};

	return (
		<div className="flex min-w-0 flex-col gap-3" data-qa-id="swarm-graph">
			<div className="text-muted-foreground flex flex-wrap justify-between gap-2 text-xs">
				<span data-qa-id="swarm-graph-summary">
					<span className="text-foreground font-medium">
						{count(drawn.length, "post", "posts")}
					</span>{" "}
					between {count(members.length, "agent", "agents")}
				</span>
				<span>Click an agent to filter the board</span>
			</div>

			<div
				ref={ref}
				className="bg-muted/40 relative w-full overflow-hidden rounded-xl"
				style={{ height: GRAPH_HEIGHT }}
			>
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
							const { d, mid } = curve(a, b, centre);
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
										className={edge.blocking ? "stroke-foreground" : "stroke-muted-foreground/60"}
										strokeWidth={Math.min(4, edge.posts.length) + (edge.blocking ? 1 : 0)}
										strokeDasharray={dimmed ? "3 4" : undefined}
										strokeLinecap="round"
									/>
									<foreignObject
										x={mid.x - 90}
										y={mid.y - 10}
										width={180}
										height={20}
										className="pointer-events-none overflow-visible"
									>
										<div className="flex h-full items-center justify-center">
											<span
												className={cn(
													"bg-pane border-border inline-block rounded-full border px-1.5 text-[10px] leading-4 whitespace-pre tabular-nums",
													edge.blocking ? "text-foreground" : "text-muted-foreground",
												)}
												data-qa-id="swarm-graph-edge-label"
											>
												{shown.map((post, index) => (
													<span
														key={post.id}
														className={inWindow.has(post.id) ? undefined : "opacity-40"}
													>
														{`${index > 0 ? " · " : ""}#${post.seq}`}
													</span>
												))}
												{more > 0 ? ` +${more}` : null}
												{note ? ` · ${note}` : null}
											</span>
										</div>
									</foreignObject>
								</g>
							);
						})}
					</svg>
				) : null}

				{width > 0
					? members.map((member) => {
							const point = layout.get(member.id);
							if (!point) return null;
							return (
								<button
									key={member.id}
									type="button"
									aria-label={`Filter the board to ${member.name}`}
									title={member.name}
									className={cn(
										"bg-muted hover:bg-accent focus-visible:ring-ring absolute flex max-w-44 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center gap-2 rounded-full py-1 ps-1 pe-3 text-sm outline-none focus-visible:ring-2",
										member.done ? "text-muted-foreground" : "text-foreground",
									)}
									style={{ left: point.x, top: point.y }}
									onClick={() => onFilter(member.id)}
									onDoubleClick={() => onOpen(member.id)}
									data-qa-id="swarm-graph-node"
									data-member-id={member.id}
									data-done={member.done}
								>
									<span className={cn("flex", member.done && "opacity-70 grayscale")}>
										<AgentAvatar name={member.name} color={colorOf(member.id)} />
									</span>
									<span className="truncate">{member.name}</span>
									{member.done ? <CheckIcon aria-label="done" className="size-3 shrink-0" /> : null}
								</button>
							);
						})
					: null}
			</div>

			{drawn.length === 0 ? (
				<p className="text-muted-foreground text-sm">No posts yet — lines appear as agents talk.</p>
			) : (
				<section
					className="bg-muted/40 flex min-w-0 flex-col gap-3 rounded-xl px-4 py-3"
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
							className="text-muted-foreground"
							disabled={full}
							onClick={() => setRange([0, SLIDER_MAX])}
							data-qa-id="swarm-graph-reset"
						>
							Reset
						</Button>
					</div>
					<div className="relative h-7">
						<div
							aria-hidden
							className="bg-border absolute top-1/2 h-px -translate-y-1/2"
							style={{ left: THUMB_R, right: THUMB_R }}
						/>
						<div
							aria-hidden
							className="absolute inset-y-0"
							style={{ left: THUMB_R, right: THUMB_R }}
						>
							<div
								className="border-border bg-foreground/5 absolute inset-y-0 rounded-md border"
								style={{
									left: `${(range[0] / SLIDER_MAX) * 100}%`,
									width: `${((range[1] - range[0]) / SLIDER_MAX) * 100}%`,
								}}
								data-qa-id="swarm-graph-window-box"
							/>
							{drawn.map((post) => (
								<span
									key={post.id}
									className={cn(
										"absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors motion-reduce:transition-none",
										inWindow.has(post.id) ? "bg-foreground/80" : "bg-muted-foreground/50",
									)}
									style={{ left: `${fractionOf(post.timestamp) * 100}%` }}
									title={`#${post.seq} · ${nameOf(post.from)} · ${clock(post.timestamp)}`}
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
						className="text-muted-foreground relative h-4 text-[11px] tabular-nums"
						style={{ marginInline: THUMB_R }}
					>
						{axis.ticks.map((tick) => {
							const fraction = fractionOf(tick);
							return (
								<span
									key={tick}
									className="absolute top-0 whitespace-nowrap"
									style={{
										left: `${fraction * 100}%`,
										transform: `translateX(-${fraction * 100}%)`,
									}}
								>
									{clock(tick)}
								</span>
							);
						})}
					</div>
				</section>
			)}

			<ul
				className="text-muted-foreground flex flex-wrap gap-x-5 gap-y-1 text-xs"
				aria-label="Legend"
			>
				<li>Line weight = number of posts</li>
				<li>Bright line = blocking (hold / veto)</li>
				<li>Dashed = outside the time window</li>
				<li>Colour = working · grey + ✓ = done</li>
			</ul>
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
				"[&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:cursor-ew-resize [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-sm",
				"[&::-moz-range-thumb]:bg-foreground [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-2 [&::-moz-range-thumb]:cursor-ew-resize [&::-moz-range-thumb]:rounded-sm [&::-moz-range-thumb]:border-0",
				"focus-visible:[&::-webkit-slider-thumb]:ring-ring focus-visible:[&::-webkit-slider-thumb]:ring-2 focus-visible:[&::-moz-range-thumb]:ring-ring focus-visible:[&::-moz-range-thumb]:ring-2",
				raised && "z-10",
			)}
		/>
	);
}
