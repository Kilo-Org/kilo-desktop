import { BotIcon } from "lucide-react";

import { Avatar, AvatarFallback } from "@kilo-desktop/ui/components/avatar";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { monsterOf } from "./swarm-monsters";

/**
 * An agent's round badge, drawn like the transcript's tool icons: a worker
 * shows its monster in its colour while it works, and in the muted grey of a
 * settled tool once done; the main agent shows the agent icon its tab uses.
 * In an {@link AvatarGroup} it overlaps its neighbours the way tool icons do.
 */
export function AgentAvatar({
	name,
	color,
	size = "md",
	done = false,
	className,
}: {
	readonly name: string;
	readonly color: string;
	readonly size?: "sm" | "md";
	/** A worker that stopped: its monster turns grey. */
	readonly done?: boolean;
	readonly className?: string;
}) {
	const monster = monsterOf(color);
	const Icon = monster?.Icon ?? BotIcon;
	return (
		<Avatar
			aria-hidden
			className={cn(size === "sm" ? "size-5" : "size-6.5", className)}
			data-monster={monster?.name}
			data-done={done || undefined}
			title={name}
		>
			<AvatarFallback
				className={cn(
					"border-2",
					monster && !done ? monster.circleClassName : "border-transparent",
				)}
			>
				<Icon className={size === "sm" ? "size-3" : "size-3.5"} />
			</AvatarFallback>
		</Avatar>
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
