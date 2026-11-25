import { cn } from "@kilo-desktop/ui/lib/utils";

import { tint } from "./swarm-colors";
import { monsterOf } from "./swarm-monsters";

/** A finished worker's circle: the design's grey on dark panes, a light grey on light ones. */
const DONE_SURFACE = "light-dark(#E5E5E5, #333333)";
const DONE_INK = "light-dark(#737373, #A3A3A3)";

/**
 * An agent's round badge. A worker shows its monster (the one paired with its
 * team colour) in that colour on a deep circle of it, ringed at 40%; once
 * done, the same monster in grey. The main agent shows its initial.
 */
export function AgentAvatar({
	name,
	color,
	size = "md",
	done = false,
}: {
	readonly name: string;
	readonly color: string;
	readonly size?: "sm" | "md";
	/** A worker that stopped: its monster turns grey. */
	readonly done?: boolean;
}) {
	const monster = monsterOf(color);
	const box = size === "sm" ? "size-5" : "size-[26px]";
	if (monster) {
		const ink = done
			? DONE_INK
			: `light-dark(color-mix(in srgb, ${monster.color} 70%, black), ${monster.color})`;
		return (
			<span
				aria-hidden
				className={cn("flex shrink-0 items-center justify-center rounded-full", box)}
				style={{
					color: ink,
					backgroundColor: done
						? DONE_SURFACE
						: `light-dark(${tint(monster.color, 18)}, ${monster.surface})`,
					boxShadow: done
						? "inset 0 0 0 1px color-mix(in srgb, currentColor 30%, transparent)"
						: `inset 0 0 0 2px ${monster.color}66`,
				}}
				data-monster={monster.name}
				data-done={done || undefined}
			>
				<monster.Icon className={size === "sm" ? "size-2.5" : "size-[13px]"} />
			</span>
		);
	}
	return (
		<span
			aria-hidden
			className={cn(
				"text-foreground flex shrink-0 items-center justify-center rounded-full leading-none font-semibold",
				box,
				size === "sm" ? "text-[10px]" : "text-xs",
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
