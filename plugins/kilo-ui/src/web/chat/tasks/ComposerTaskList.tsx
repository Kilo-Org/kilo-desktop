import { memo, useState } from "react";
import { ChevronDownIcon, Loader2Icon } from "lucide-react";

import { cn } from "@kilo-desktop/ui/lib/utils";

import { TaskList } from "../components/assistant-ui/elements/task-list.js";
import { useTaskThreadProjection } from "./use-task-thread-projection.js";

export const ComposerTaskList = memo(() => {
	const projection = useTaskThreadProjection();
	const [collapsed, setCollapsed] = useState(false);
	if (!projection?.items?.some((item) => item.status === "pending" || item.status === "active")) {
		return null;
	}
	const done = projection.items.filter((item) => item.status === "done").length;
	const activeItem = projection.items.find((item) => item.status === "active");

	return (
		<div
			className="border-border/60 chat-composer-glass chat-composer-surface overflow-hidden rounded-xl border shadow-[0_8px_24px_-20px_rgba(0,0,0,0.7)]"
			data-qa-id="kilo-composer-tasks"
		>
			<button
				type="button"
				className={cn(
					"text-muted-foreground hover:bg-muted/35 focus-visible:ring-ring/50 flex h-8 w-full items-center justify-between px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2",
					!collapsed && "border-border/40 border-b",
				)}
				aria-expanded={!collapsed}
				aria-controls="kilo-composer-task-items"
				onClick={() => setCollapsed((value) => !value)}
				data-qa-id="kilo-composer-tasks-toggle"
			>
				<span className="flex min-w-0 items-center gap-2">
					<span className="shrink-0">Tasks</span>
					{collapsed && activeItem ? (
						<span className="text-foreground/70 flex min-w-0 items-center gap-1.5 font-normal">
							<span aria-hidden className="text-foreground/25">
								·
							</span>
							<Loader2Icon className="text-primary size-3 shrink-0 animate-spin motion-reduce:animate-none" />
							<span className="truncate" data-qa-id="kilo-composer-tasks-active">
								{activeItem.text}
							</span>
						</span>
					) : null}
				</span>
				<span className="flex items-center gap-2">
					<span className="text-foreground/35 tabular-nums">
						{done}/{projection.items.length} Completed
					</span>
					<ChevronDownIcon
						className={cn("size-3.5 transition-transform duration-150", collapsed && "-rotate-90")}
					/>
				</span>
			</button>
			{!collapsed ? (
				<TaskList id="kilo-composer-task-items" className="p-2" items={projection.items} />
			) : null}
		</div>
	);
});

ComposerTaskList.displayName = "ComposerTaskList";
