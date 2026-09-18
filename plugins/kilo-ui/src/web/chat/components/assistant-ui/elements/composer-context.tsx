"use client";

import { type ComponentProps, type ReactNode } from "react";

import { Separator } from "@kilo-desktop/ui/components/separator";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	formatCompactCount,
	type ComposerContextUsage,
	type ComposerTokenUsage,
} from "../../../usage/session-model-usage.js";
import { clamp, pct } from "../utils/range.js";
import { ghostButton } from "./surfaces.js";

export type { ComposerContextUsage, ComposerTokenUsage };

const TOKEN_STATS = [
	{ key: "input", label: "Input" },
	{ key: "output", label: "Output" },
	{ key: "reasoning", label: "Reasoning" },
	{ key: "cacheRead", label: "Cache Read" },
	{ key: "cacheWrite", label: "Cache Write" },
] as const;

export function ComposerContext({
	usage,
	tokens,
	className,
	children,
	rail,
	...props
}: ComponentProps<"div"> & {
	usage: ComposerContextUsage;
	tokens: ComposerTokenUsage;
	children?: ReactNode;
	rail?: ReactNode;
}) {
	const used = usage.used;
	const fraction = usage.total === 0 ? 0 : used / usage.total;
	const warn = fraction > 0.85;
	const circumference = 2 * Math.PI * 6;
	const fill = pct(used, usage.total);

	return (
		<div
			data-slot="composer-context"
			className={cn("group/ctx relative inline-flex max-w-full", className)}
			{...props}
		>
			<div
				data-qa-id="kilo-composer-context-popover"
				className={cn(
					"bg-popover/95 text-popover-foreground absolute end-0 bottom-full z-10 mb-2 flex origin-bottom-right flex-col gap-3 rounded-xl p-2.5 text-sm shadow-lg backdrop-blur-sm ring-1 ring-foreground/10 after:absolute after:inset-x-0 after:top-full after:h-2 after:content-['']",
					children ? "w-80" : "w-64",
					"transition-[opacity,scale] duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none",
					"pointer-events-none scale-[0.97] opacity-0",
					"group-hover/ctx:pointer-events-auto group-hover/ctx:scale-100 group-hover/ctx:opacity-100",
					"group-focus-within/ctx:pointer-events-auto group-focus-within/ctx:scale-100 group-focus-within/ctx:opacity-100",
				)}
			>
				<div className="flex flex-col gap-2">
					<p className="font-medium">Context</p>
					<div className="flex items-baseline justify-between gap-3">
						<p className="text-muted-foreground text-xs tabular-nums">
							{formatCompactCount(used)} / {formatCompactCount(usage.total)}
						</p>
						<p
							className={cn(
								"text-xs tabular-nums",
								warn ? "text-destructive" : "text-muted-foreground",
							)}
						>
							{Math.round(fill)}%
						</p>
					</div>
					<div className="bg-muted h-1.5 w-full overflow-hidden rounded-full">
						{fill > 0 ? (
							<span
								className="bg-foreground/80 block h-full rounded-full transition-[width] duration-700 motion-reduce:transition-none"
								style={{ width: `${fill}%` }}
							/>
						) : null}
					</div>
				</div>
				<Separator />
				<div className="flex flex-col gap-1.5">
					<p className="font-medium">Token usage</p>
					<div className="text-muted-foreground flex flex-col gap-1.5 text-xs">
						{TOKEN_STATS.map((stat) => (
							<div key={stat.label} className="flex items-center justify-between gap-2.5">
								<span>{stat.label}</span>
								<span className="tabular-nums">{formatCompactCount(tokens[stat.key])}</span>
							</div>
						))}
					</div>
				</div>
				{children ? (
					<>
						<Separator />
						{children}
					</>
				) : null}
			</div>
			<button
				type="button"
				aria-label="Context usage"
				className={cn(
					ghostButton,
					rail ? "h-7 w-fit max-w-full shrink-0 gap-2.5 rounded-md px-2.5 py-1 text-xs" : "size-8",
					warn && "text-destructive",
				)}
			>
				{rail}
				<svg viewBox="0 0 16 16" className="size-4 shrink-0 -rotate-90" aria-hidden>
					<circle
						cx="8"
						cy="8"
						r="6"
						fill="none"
						strokeWidth="2.5"
						className="stroke-foreground/10"
					/>
					<circle
						cx="8"
						cy="8"
						r="6"
						fill="none"
						strokeWidth="2.5"
						strokeLinecap="round"
						className="stroke-current transition-[stroke-dashoffset] duration-700 motion-reduce:transition-none"
						strokeDasharray={circumference}
						strokeDashoffset={circumference * (1 - clamp(fraction, 0, 1))}
					/>
				</svg>
			</button>
		</div>
	);
}
