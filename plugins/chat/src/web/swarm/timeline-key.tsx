import { InfoIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import type { SequenceArrow } from "./team-sequence";
import { RUN_GAP_MS } from "./team-timeline";

/** How a post's arrow is drawn: dashed for INFO, heavier for what blocks someone. */
export function strokeOf(type: SequenceArrow["type"]): { dash?: string; width: number } {
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

type Mark = "span" | "unknown" | "post" | "info" | "hold" | "everyone" | "reply";

/** Each mark the chart draws: a short name for the strip, a fuller one on hover. */
const MARKS: readonly { readonly mark: Mark; readonly short: string; readonly long: string }[] = [
	{ mark: "span", short: "Active", long: "When an agent was active" },
	{ mark: "unknown", short: "End unknown", long: "Active, but when it stopped isn't known" },
	{ mark: "post", short: "Post", long: "A post from one agent to another" },
	{ mark: "info", short: "Info", long: "An INFO post" },
	{ mark: "hold", short: "Hold / veto", long: "A HOLD or VETO: it blocks someone" },
	{ mark: "everyone", short: "To everyone", long: "A post to the whole team" },
	{ mark: "reply", short: "Reply", long: "Links a reply to its post, on hover" },
];

const arrow = (type: SequenceArrow["type"]) => {
	const { dash, width } = strokeOf(type);
	return (
		<>
			<line
				x1={1}
				y1={5}
				x2={13}
				y2={5}
				stroke="currentColor"
				strokeWidth={width}
				strokeDasharray={dash}
			/>
			<path d="M 12 1.5 L 18 5 L 12 8.5 Z" fill="currentColor" />
		</>
	);
};

/** A mark drawn the way the chart draws it, in the text color. */
function Glyph({ mark }: { readonly mark: Mark }) {
	return (
		<svg
			width={20}
			height={10}
			viewBox="0 0 20 10"
			aria-hidden
			className="shrink-0 overflow-visible"
		>
			{mark === "span" ? (
				<rect x={1} y={2} width={18} height={6} rx={2.5} fill="currentColor" fillOpacity={0.4} />
			) : mark === "unknown" ? (
				<rect
					x={1}
					y={2}
					width={18}
					height={6}
					rx={2.5}
					fill="none"
					stroke="currentColor"
					strokeDasharray="3 2"
				/>
			) : mark === "post" ? (
				arrow("ASK")
			) : mark === "info" ? (
				arrow("INFO")
			) : mark === "hold" ? (
				arrow("HOLD")
			) : mark === "everyone" ? (
				<>
					<circle cx={3.5} cy={5} r={2.5} fill="currentColor" />
					{[10, 14, 18].map((x) => (
						<line key={x} x1={x} x2={x} y1={1} y2={9} stroke="currentColor" strokeWidth={1.5} />
					))}
				</>
			) : (
				<path d="M 1 8 Q 10 -2 19 8" fill="none" stroke="currentColor" strokeDasharray="2 2" />
			)}
		</svg>
	);
}

/** What the chart can't show, said behind each chart's ⓘ. */
const PERIOD_CAVEAT = `Activity periods are split at quiet gaps of at least ${RUN_GAP_MS / 60_000} minutes, not recorded agent turns.`;
const SPAN_CAVEAT =
	"Activity uses recorded starts, ends and last known activity, not continuous execution.";
const LANE_CAVEAT = "Only senders with a team lane are plotted.";

/**
 * One quiet row of marks under a chart, so the encoding reads at a glance,
 * with the plotted-post count and its caveats behind an ⓘ.
 */
export function TimelineKeyStrip({
	plotted,
	more,
}: {
	readonly plotted: number;
	/** Older posts exist that aren't loaded, so aren't plotted. */
	readonly more: boolean;
}) {
	const about = [
		`${plotted === 1 ? "1 post" : `${plotted} posts`} plotted from loaded history${more ? "; older posts aren't loaded" : ""}.`,
		LANE_CAVEAT,
		SPAN_CAVEAT,
		PERIOD_CAVEAT,
	].join(" ");
	return (
		<div
			className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs"
			data-qa-id="swarm-timeline-key"
		>
			<ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1" aria-label="Timeline key">
				{MARKS.map(({ mark, short, long }) => (
					<li key={mark} className="flex items-center gap-1.5 whitespace-nowrap" title={long}>
						<Glyph mark={mark} />
						{short}
					</li>
				))}
			</ul>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="xs"
							className="text-muted-foreground gap-1 tabular-nums"
							aria-label={about}
							data-qa-id="swarm-timeline-about"
						/>
					}
				>
					{plotted === 1 ? "1 post" : `${plotted} posts`}
					<InfoIcon aria-hidden />
				</TooltipTrigger>
				<TooltipContent className="max-w-64">{about}</TooltipContent>
			</Tooltip>
		</div>
	);
}
