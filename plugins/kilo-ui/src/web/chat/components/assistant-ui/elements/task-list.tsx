"use client";

import type { ComponentProps } from "react";
import { BanIcon, CheckIcon, XIcon } from "lucide-react";

import { Spinner } from "@kilo-desktop/ui/components/spinner";

import { cn } from "@kilo-desktop/ui/lib/utils";

export type TaskStatus = "pending" | "active" | "done" | "failed" | "cancelled";

export interface TaskItem {
	id: string;
	text: string;
	status: TaskStatus;
	reason?: string;
}

export function TaskStatusIcon({ status }: { status: TaskStatus }) {
	return (
		<span aria-hidden className="flex size-4 h-5 shrink-0 items-center justify-center">
			{status === "done" ? (
				<span className="border-foreground/20 bg-foreground/[0.06] flex size-3.5 items-center justify-center rounded-sm border">
					<CheckIcon className="text-foreground/45 size-2.5" />
				</span>
			) : status === "failed" ? (
				<span className="border-destructive/25 bg-destructive/[0.08] flex size-3.5 items-center justify-center rounded-sm border">
					<XIcon className="text-destructive size-2.5" />
				</span>
			) : status === "cancelled" ? (
				<BanIcon className="text-foreground/30 size-3.5" />
			) : status === "active" ? (
				<Spinner className="text-primary-ink size-3 motion-reduce:animate-none" />
			) : (
				<span className="border-foreground/15 size-3.5 rounded-sm border" />
			)}
		</span>
	);
}

export function TaskList({
	items,
	className,
	...props
}: Omit<ComponentProps<"ul">, "children" | "items"> & {
	items: readonly TaskItem[];
}) {
	return (
		<ul
			data-slot="task-list"
			className={cn("scroll-fade-y flex max-h-44 flex-col gap-1 overflow-y-auto", className)}
			{...props}
		>
			{items.map((item) => (
				<li
					key={item.id}
					className="fade-in slide-in-from-bottom-1 animate-in fill-mode-both flex items-start gap-2.5 py-0.5 text-sm duration-300"
				>
					<TaskStatusIcon status={item.status} />
					<span className="sr-only">{item.status}</span>
					<div className="min-w-0 flex-1 leading-5 break-words">
						<span
							className={cn(
								item.status === "done" && "text-foreground/35 line-through decoration-[1.5px]",
								item.status === "active" && "text-foreground/90",
								item.status === "pending" && "text-foreground/50",
								item.status === "cancelled" && "text-foreground/30 line-through decoration-[1.5px]",
								item.status === "failed" && "text-destructive",
							)}
						>
							{item.text}
						</span>
						{item.status === "failed" && item.reason ? (
							<p className="text-foreground/45 text-xs leading-4 break-words">{item.reason}</p>
						) : null}
					</div>
				</li>
			))}
		</ul>
	);
}
