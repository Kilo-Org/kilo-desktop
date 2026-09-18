import type { LucideIcon } from "lucide-react";

import { cn } from "@kilo-desktop/ui/lib/utils";

export function AgentIcon({
	icon: Icon,
	color,
	className,
	size = 14,
}: {
	icon: LucideIcon;
	color?: string | undefined;
	className?: string;
	size?: number;
}) {
	return (
		<span className={cn("flex shrink-0 items-center justify-center", className)} aria-hidden>
			{/* Lucide `color` sets stroke directly so menu focus/hover text utilities cannot recolor it. */}
			<Icon size={size} {...(color ? { color } : {})} />
		</span>
	);
}
