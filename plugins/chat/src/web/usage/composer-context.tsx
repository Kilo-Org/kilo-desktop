"use client";

import { useState, type ComponentProps, type ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@kilo-desktop/ui/components/popover";
import { Progress } from "@kilo-desktop/ui/components/progress";
import { Separator } from "@kilo-desktop/ui/components/separator";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	formatCompactCount,
	type ComposerContextUsage,
	type ComposerTokenUsage,
} from "./session-model-usage";
import { clamp, pct } from "./range";
import { ghostButton } from "./surfaces";

export type { ComposerContextUsage, ComposerTokenUsage };

const TOKEN_STATS = [
	{ key: "input", label: "Input" },
	{ key: "output", label: "Output" },
	{ key: "reasoning", label: "Reasoning" },
	{ key: "cacheRead", label: "Cache read" },
	{ key: "cacheWrite", label: "Cache write" },
] as const;

export function ComposerContext({
	usage,
	tokens,
	className,
	children,
	rail,
	onClick,
	...props
}: ComponentProps<"button"> & {
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
	const [open, setOpen] = useState(false);

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<button
						type="button"
						aria-label="Context usage"
						data-slot="composer-context"
						className={cn(
							ghostButton,
							"relative inline-flex max-w-full",
							rail ? "h-7 w-fit shrink-0 gap-2.5 rounded-md px-2.5 py-1 text-xs" : "size-8",
							warn && "text-destructive",
							className,
						)}
						{...props}
						onClick={(event) => {
							onClick?.(event);
							if (event.defaultPrevented) return;
							(
								event as typeof event & {
									preventBaseUIHandler: () => void;
								}
							).preventBaseUIHandler();
							setOpen((value) => !value);
						}}
					/>
				}
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
			</PopoverTrigger>
			<PopoverContent
				data-qa-id="kilo-composer-context-popover"
				side="top"
				align="end"
				className={cn("data-closed:hidden flex flex-col gap-3", children ? "w-80" : "w-64")}
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
					<Progress value={fill} aria-label="Context used" />
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
			</PopoverContent>
		</Popover>
	);
}
