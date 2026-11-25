"use client";

import type { ComponentProps } from "react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { paper } from "./surfaces";

export function CostMeter({
	runCost,
	sessionCost,
	className,
	...props
}: Omit<ComponentProps<"div">, "children" | "runCost" | "sessionCost"> & {
	runCost: string;
	sessionCost: string;
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
		</div>
	);
}
