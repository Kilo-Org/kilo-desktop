import { cn } from "@kilo-desktop/ui/lib/utils";

import { tint } from "./swarm-colors";

/** An agent's round badge: its initial on a soft fill of its color, ringed in it. */
export function AgentAvatar({
	name,
	color,
	size = "md",
}: {
	readonly name: string;
	readonly color: string;
	readonly size?: "sm" | "md";
}) {
	return (
		<span
			aria-hidden
			className={cn(
				"text-foreground flex shrink-0 items-center justify-center rounded-full leading-none font-semibold",
				size === "sm" ? "size-5 text-[10px]" : "size-6 text-xs",
			)}
			style={{ backgroundColor: tint(color, 24), boxShadow: `inset 0 0 0 1.5px ${color}` }}
		>
			{name.trim().charAt(0).toUpperCase() || "?"}
		</span>
	);
}

/** A name with its color dot, for recipients and picker entries. */
export function ColorName({
	name,
	color,
}: {
	readonly name: string;
	readonly color?: string | undefined;
}) {
	return (
		<span className="inline-flex min-w-0 items-center gap-1.5">
			{color ? (
				<span
					aria-hidden
					className="size-2 shrink-0 rounded-full"
					style={{ backgroundColor: color }}
				/>
			) : null}
			<span className="truncate">{name}</span>
		</span>
	);
}
