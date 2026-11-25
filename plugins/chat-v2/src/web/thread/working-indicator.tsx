import { useAuiState } from "@assistant-ui/react";
import { useEffect, useState, type FC } from "react";

import { Avatar, AvatarFallback, AvatarGroup } from "@kilo-desktop/ui/components/avatar";
import { cn } from "@kilo-desktop/ui/lib/utils";

import "./assistant-working-indicator.css";

const CONSIDERING_NEXT_STEPS = "Considering next steps";
const CONSIDERING_INDICATOR_DELAY_MS = 750;
const WORKING_INDICATOR_PIXEL_DELAYS = Array.from({ length: 9 }, (_, index) => {
	const row = Math.floor(index / 3);
	return ((index % 3) + Math.abs(row - 1)) * 90;
});

function formatElapsedTime(deciseconds: number) {
	const seconds = deciseconds / 10;
	if (seconds < 60) return `${seconds.toFixed(1)}s`;
	return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
}

export function formatTurnDuration(durationMs: number) {
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
}

const elapsedDecisecondsSince = (startedAt: number) =>
	Math.max(0, Math.floor((Date.now() - startedAt) / 100));

/** When the turn this assistant message answers began: its user message, else itself. */
export function useTurnStartedAt(): number {
	return useAuiState((s) => {
		for (let index = s.message.index - 1; index >= 0; index--) {
			const message = s.thread.messages[index];
			if (message?.role === "user") return message.createdAt.getTime();
		}
		return s.message.createdAt.getTime();
	});
}

/**
 * "Considering next steps" while a running turn is between steps, revealed
 * after a short delay so quick gaps don't flash.
 */
export const AssistantWorkingIndicator: FC<{ active: boolean; overlay: boolean }> = ({
	active,
	overlay,
}) => {
	const turnStartedAt = useTurnStartedAt();
	const label = CONSIDERING_NEXT_STEPS;
	const [isRevealed, setIsRevealed] = useState(false);
	const [elapsedDeciseconds, setElapsedDeciseconds] = useState(() =>
		elapsedDecisecondsSince(turnStartedAt),
	);

	// The delay only debounces inactive→active gaps.
	if (!active && isRevealed) setIsRevealed(false);
	useEffect(() => {
		if (!active || isRevealed) return;
		const timeoutId = window.setTimeout(() => setIsRevealed(true), CONSIDERING_INDICATOR_DELAY_MS);
		return () => window.clearTimeout(timeoutId);
	}, [active, isRevealed]);

	useEffect(() => {
		if (!active) return;
		const update = () => setElapsedDeciseconds(elapsedDecisecondsSince(turnStartedAt));
		update();
		const intervalId = window.setInterval(update, 100);
		return () => window.clearInterval(intervalId);
	}, [active, turnStartedAt]);

	const isVisible = active && isRevealed;

	return (
		<div
			data-slot="aui_assistant-message-indicator"
			className={cn(
				"text-muted-foreground flex w-fit items-center gap-2 py-1 text-sm",
				overlay && "absolute mt-3",
				!isVisible && "invisible",
			)}
			role={isVisible ? "status" : undefined}
			aria-label={isVisible ? label : undefined}
			aria-hidden={!isVisible}
		>
			<AvatarGroup aria-hidden className="*:data-[slot=avatar]:ring-pane -space-x-1">
				<Avatar className="size-6.5">
					<AvatarFallback className="border-2 border-transparent">
						<span className="grid grid-cols-[repeat(3,3px)] gap-[2.5px]">
							{WORKING_INDICATOR_PIXEL_DELAYS.map((delay, index) => (
								<span
									key={index}
									className="assistant-working-pixel size-[3px] rounded-[1px] bg-current"
									style={{ animationDelay: `${delay}ms` }}
								/>
							))}
						</span>
					</AvatarFallback>
				</Avatar>
			</AvatarGroup>
			<span aria-hidden className="relative inline-block font-normal">
				{label}
				<span className="shimmer shimmer-color-foreground pointer-events-none absolute top-0 left-0 motion-reduce:animate-none">
					{label}
				</span>
			</span>
			{label === CONSIDERING_NEXT_STEPS ? null : (
				<span aria-hidden className="font-mono text-xs tabular-nums opacity-60">
					{formatElapsedTime(elapsedDeciseconds)}
				</span>
			)}
		</div>
	);
};

const WorkingTimer: FC<{ startedAt: number }> = ({ startedAt }) => {
	const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);
	useEffect(() => {
		const update = () => setElapsed(Math.max(0, Date.now() - startedAt));
		update();
		const intervalId = window.setInterval(update, 1_000);
		return () => window.clearInterval(intervalId);
	}, [startedAt]);
	return <span className="tabular-nums">{formatTurnDuration(elapsed)}</span>;
};

/** "Working for 12s" above a running turn. */
export const TurnWorkHeader: FC<{ startedAt: number }> = ({ startedAt }) => (
	<div
		className="text-muted-foreground border-border-subtle mb-2 flex w-full items-center border-b pt-2 pb-2 text-xs"
		role="status"
		data-qa-id="kilo-turn-working"
	>
		<span>
			Working for <WorkingTimer startedAt={startedAt} />
		</span>
	</div>
);
