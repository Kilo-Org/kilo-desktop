"use client";

import type { ComponentProps } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { announced, pct } from "./range";
import { paper } from "./surfaces";

const SHARE_FILLS = [
	"bg-blue-500 dark:bg-blue-400",
	"bg-blue-500/55 dark:bg-blue-400/55",
	"bg-foreground/25",
] as const;

function shareFill(index: number): (typeof SHARE_FILLS)[number] {
	if (index <= 0) return SHARE_FILLS[0];
	if (index === 1) return SHARE_FILLS[1];
	return SHARE_FILLS[2];
}

export interface CostLine {
	model: string;
	inputTokens: number;
	outputTokens: number;
	cost: string;
	share: number;
}

export function CostMeter({
	runCost,
	sessionCost,
	lines,
	className,
	...props
}: Omit<ComponentProps<"div">, "children" | "runCost" | "sessionCost" | "lines"> & {
	runCost: string;
	sessionCost: string;
	lines: readonly CostLine[];
}) {
	return (
		<div
			data-slot="cost-meter"
			className={cn(
				paper,
				"flex w-full max-w-sm flex-col gap-2 rounded-xl p-3.5 text-sm",
				className,
			)}
			{...props}
		>
			<div className="flex items-baseline gap-2">
				<span className="font-medium tabular-nums">{sessionCost}</span>
				<span className="text-muted-foreground text-xs">session</span>
				<span className="text-muted-foreground ms-auto flex items-baseline gap-2 text-xs">
					<span className="font-medium tabular-nums">{runCost}</span>
					<span>last turn</span>
				</span>
			</div>

			<div className="bg-muted flex h-1.5 w-full overflow-hidden rounded-full">
				{lines.map((line, i) => {
					const width = pct(line.share, 1);
					if (announced(width) === 0) return null;
					return (
						<span
							key={line.model}
							role="meter"
							aria-label={`${line.model} cost share`}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={announced(width)}
							className={cn(
								"h-full transition-[width] duration-500 motion-reduce:transition-none",
								shareFill(i),
							)}
							style={{ width: `${width}%` }}
						/>
					);
				})}
			</div>

			<div className="flex flex-col gap-1.5">
				{lines.map((line, i) => (
					<div key={line.model} className="text-muted-foreground flex items-center gap-2.5 text-xs">
						<span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", shareFill(i))} />
						<span className="text-foreground min-w-0 flex-1 truncate">{line.model}</span>
						<span className="shrink-0 tabular-nums">
							{(line.inputTokens / 1000).toFixed(1)}k in · {(line.outputTokens / 1000).toFixed(1)}k
							out
						</span>
						<span className="shrink-0 tabular-nums">{line.cost}</span>
					</div>
				))}
			</div>
		</div>
	);
}
