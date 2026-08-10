import {
	BotIcon,
	BugIcon,
	HammerIcon,
	ListTodoIcon,
	MessageCircleQuestionIcon,
	type LucideIcon,
} from "lucide-react";

import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

const AGENT_ICONS: Record<string, LucideIcon> = {
	code: HammerIcon,
	build: HammerIcon,
	plan: ListTodoIcon,
	ask: MessageCircleQuestionIcon,
	debug: BugIcon,
};

export function AgentIcon({
	name,
	color,
	className,
	size = 14,
}: {
	name: string;
	color?: string | undefined;
	className?: string;
	size?: number;
}) {
	const Icon = AGENT_ICONS[name] ?? BotIcon;

	return (
		<span className={cn("flex shrink-0 items-center justify-center", className)} aria-hidden>
			{/* Lucide `color` sets stroke directly so menu focus/hover text utilities cannot recolor it. */}
			<Icon size={size} {...(color ? { color } : {})} />
		</span>
	);
}
