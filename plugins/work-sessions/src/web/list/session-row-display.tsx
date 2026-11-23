import { CircleAlertIcon, MessageCircleQuestionMarkIcon } from "lucide-react";
import { useEffect, useState, type FC } from "react";

import { Spinner } from "@kilo-desktop/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	formatRelativeTimeLabel,
	formatWorkingDurationLabel,
	type SessionRowState,
} from "./session-activity";

/*
 * How a chat's state and age are shown wherever chats are listed: the sidebar
 * rows and the workspace board cards.
 */

/** Props passed to `kilo-ui/chat-session-row-metadata` contributions (e.g. the PR badge). */
export type SessionRowMetadataProps = {
	statusId: string;
	directory: string;
	branch?: string;
	/**
	 * The metadata can be clicked on its own, so it may render controls such as
	 * links. Board cards set it; sidebar rows do not, since the whole row is the
	 * control that opens the chat.
	 */
	interactive?: boolean;
};

export const SESSION_ROW_STATE_LABELS: Record<
	Exclude<SessionRowState, null>,
	{ label: string; className: string }
> = {
	approval: { label: "Requires approval", className: "text-warning" },
	input: { label: "Requires input", className: "text-warning" },
	working: { label: "Working", className: "text-info" },
	// Finished but not yet opened. The glyph draws it as a primary-ink dot; text uses the same colour.
	done: { label: "Unread", className: "text-primary-ink" },
};

/** One shared interval per tick rate so every row doesn't open its own timer. */
const nowListeners = new Map<number, Set<(now: number) => void>>();
const nowIntervals = new Map<number, ReturnType<typeof setInterval>>();

function subscribeSharedNow(intervalMs: number, listener: (now: number) => void): () => void {
	let listeners = nowListeners.get(intervalMs);
	if (!listeners) {
		listeners = new Set();
		nowListeners.set(intervalMs, listeners);
		nowIntervals.set(
			intervalMs,
			setInterval(() => {
				const now = Date.now();
				for (const notify of listeners!) notify(now);
			}, intervalMs),
		);
	}
	listeners.add(listener);
	return () => {
		listeners!.delete(listener);
		if (listeners!.size > 0) return;
		clearInterval(nowIntervals.get(intervalMs)!);
		nowListeners.delete(intervalMs);
		nowIntervals.delete(intervalMs);
	};
}

/** The current time, refreshed every `intervalMs` (one shared timer per interval). */
export function useNow(intervalMs: number): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => subscribeSharedNow(intervalMs, setNow), [intervalMs]);
	return now;
}

export const SessionRelativeTime: FC<{ timestamp: number }> = ({ timestamp }) => {
	const now = useNow(30_000);
	return <>{formatRelativeTimeLabel(timestamp, now)}</>;
};

const WorkingTooltipLabel: FC<{ label: string; startedAt: number }> = ({ label, startedAt }) => {
	const now = useNow(1_000);
	return (
		<>
			{label} · {formatWorkingDurationLabel(now - startedAt)}
		</>
	);
};

const SessionRowGlyphIcon: FC<{ rowState: Exclude<SessionRowState, null> }> = ({ rowState }) => (
	<>
		{rowState === "working" ? <Spinner aria-hidden className="size-3.5" /> : null}
		{rowState === "done" ? (
			<span
				data-qa-id="session-list-done-dot"
				aria-hidden
				className="bg-primary-ink size-1.5 rounded-full"
			/>
		) : null}
		{rowState === "approval" ? <CircleAlertIcon aria-hidden className="size-3.5" /> : null}
		{rowState === "input" ? (
			<MessageCircleQuestionMarkIcon aria-hidden className="size-3.5" />
		) : null}
	</>
);

export const SessionRowGlyph: FC<{
	rowState: SessionRowState;
	isActive: boolean;
	workingSince: number | undefined;
	/** Icon only, for surfaces that already show the state as text (board cards). */
	decorative?: boolean;
}> = ({ rowState, isActive, workingSince, decorative = false }) => {
	if (rowState === null) return null;
	const { label, className } = SESSION_ROW_STATE_LABELS[rowState];
	const glyphClassName = cn(
		"inline-flex size-3.5 shrink-0 items-center justify-center",
		rowState !== "done" && className,
		rowState === "working" && !isActive && "opacity-75",
	);
	if (decorative) {
		return (
			<span aria-hidden className={glyphClassName}>
				<SessionRowGlyphIcon rowState={rowState} />
			</span>
		);
	}
	return (
		<TooltipProvider delay={300}>
			<Tooltip>
				<TooltipTrigger
					render={<span role="status" aria-label={label} className={glyphClassName} />}
				>
					<SessionRowGlyphIcon rowState={rowState} />
				</TooltipTrigger>
				<TooltipContent side="right">
					{rowState === "working" && workingSince !== undefined ? (
						<WorkingTooltipLabel label={label} startedAt={workingSince} />
					) : (
						label
					)}
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};
