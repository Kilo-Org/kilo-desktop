import { useState } from "react";

import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { ComposerShelf, ComposerShelfToggle } from "../thread/composer-shelf";
import { TaskList } from "./task-list";
import { useTaskThreadProjection } from "./use-task-thread-projection";

export function ComposerTaskList() {
	const projection = useTaskThreadProjection();
	const [collapsed, setCollapsed] = useState(false);
	if (!projection?.items?.some((item) => item.status === "pending" || item.status === "active")) {
		return null;
	}
	const done = projection.items.filter((item) => item.status === "done").length;
	const activeItem = projection.items.find((item) => item.status === "active");

	return (
		<ComposerShelf data-qa-id="kilo-composer-tasks">
			<ComposerShelfToggle
				collapsed={collapsed}
				aria-controls="kilo-composer-task-items"
				onClick={() => setCollapsed((value) => !value)}
				data-qa-id="kilo-composer-tasks-toggle"
				trailing={
					<span className="text-foreground/35 tabular-nums">
						{done}/{projection.items.length} Completed
					</span>
				}
			>
				<span className="flex min-w-0 items-center gap-2">
					<span className="shrink-0">Tasks</span>
					{collapsed && activeItem ? (
						<span className="text-foreground/70 flex min-w-0 items-center gap-1.5 font-normal">
							<span aria-hidden className="text-foreground/25">
								·
							</span>
							<Spinner className="text-primary-ink size-3 shrink-0 motion-reduce:animate-none" />
							<span className="truncate" data-qa-id="kilo-composer-tasks-active">
								{activeItem.text}
							</span>
						</span>
					) : null}
				</span>
			</ComposerShelfToggle>
			{!collapsed ? (
				<TaskList id="kilo-composer-task-items" className="p-2" items={projection.items} />
			) : null}
		</ComposerShelf>
	);
}
