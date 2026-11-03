import { useState, type FC } from "react";

import type { Contribution } from "@kilo-desktop/kernel";
import { RenderContribution, useExtensions, useKernel } from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@kilo-desktop/ui/components/popover";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	StatusBarItem,
	type StatusBarItemImplementation,
	type StatusBarItemTrigger,
} from "../../contracts";

type StatusBarContribution = Contribution<typeof StatusBarItem>;
type Of<K extends StatusBarItemImplementation["kind"]> = Extract<
	StatusBarItemImplementation,
	{ kind: K }
>;

const NO_TRIGGER = (): StatusBarItemTrigger => ({});

const TONE_CLASS = {
	default: "",
	warning: "text-warning",
	error: "text-destructive",
} as const;

/**
 * The status bar at the bottom of the window: its items at its start and end.
 * Absent while nothing is contributed, and hidden while every item renders
 * nothing (a contribution may only have something to say some of the time).
 * It mirrors the top bar (`titlebar-row`, flipped), so its items sit level
 * with the account entry and settings button in the sidebar footer.
 */
export function StatusBar() {
	const items = useExtensions(StatusBarItem);
	if (items.length === 0) return null;
	const at = (align: "start" | "end") => items.filter((item) => item.metadata.align === align);
	return (
		<div
			role="status"
			data-qa-id="shell-status-bar"
			className="text-muted-foreground flex h-(--shell-titlebar-height) shrink-0 items-center justify-between gap-3 px-2 pb-[calc(3rem-var(--shell-titlebar-height))] text-xs [&:not(:has(>[data-slot=status-group]>*))]:hidden"
		>
			<StatusGroup align="start" items={at("start")} />
			<StatusGroup align="end" items={at("end")} />
		</div>
	);
}

const StatusGroup: FC<{ align: "start" | "end"; items: readonly StatusBarContribution[] }> = ({
	align,
	items,
}) => (
	<div
		data-slot="status-group"
		data-qa-id={`shell-status-bar-${align}`}
		className={cn("flex min-w-0 items-center gap-1", align === "end" && "justify-end")}
	>
		{items.map((item) =>
			item.implementation ? (
				<RenderContribution
					key={item.key}
					contribution={item}
					props={{ item }}
					select={() => ContributedItem}
				/>
			) : item.metadata.command ? (
				<ActionItem key={item.key} item={item} implementation={{ kind: "action" }} />
			) : null,
		)}
	</div>
);

const ContributedItem: FC<{ item: StatusBarContribution }> = ({ item }) => {
	const implementation = item.implementation!;
	if (implementation.kind !== item.metadata.kind) {
		console.warn(
			`[kilo.shell] ${item.key} is declared a ${item.metadata.kind} status item but implemented as a ${implementation.kind}.`,
		);
		return null;
	}
	switch (implementation.kind) {
		case "view": {
			const { Component } = implementation;
			return <Component />;
		}
		case "action":
			return <ActionItem item={item} implementation={implementation} />;
		case "popover":
			return <PopoverItem item={item} implementation={implementation} />;
	}
};

const TriggerContent: FC<{ trigger: StatusBarItemTrigger }> = ({ trigger }) => {
	const Icon = trigger.icon;
	return (
		<>
			{Icon ? <Icon className="size-3" /> : null}
			{trigger.label !== undefined ? <span className="truncate">{trigger.label}</span> : null}
		</>
	);
};

function triggerProps(item: StatusBarContribution, trigger: StatusBarItemTrigger) {
	const tone = trigger.tone ?? "default";
	return {
		variant: "ghost" as const,
		size: "xs" as const,
		"aria-label": trigger.ariaLabel ?? item.metadata.title,
		title: trigger.tooltip ?? item.metadata.title,
		"data-qa-id": `shell-status-bar-item-${item.id}`,
		"data-tone": tone,
		className: cn("text-muted-foreground h-5 min-w-0 px-1.5 font-normal", TONE_CLASS[tone]),
	};
}

const ActionItem: FC<{ item: StatusBarContribution; implementation: Of<"action"> }> = ({
	item,
	implementation,
}) => {
	const kernel = useKernel();
	const useTrigger = implementation.useTrigger ?? NO_TRIGGER;
	const trigger = useTrigger();
	if (trigger.hidden) return null;
	const run = () => {
		if (implementation.run) return void implementation.run();
		const { command } = item.metadata;
		if (command) void kernel.commands.execute(command).catch(() => undefined);
	};
	return (
		<Button type="button" {...triggerProps(item, trigger)} onClick={run}>
			<TriggerContent trigger={trigger} />
		</Button>
	);
};

const PopoverItem: FC<{ item: StatusBarContribution; implementation: Of<"popover"> }> = ({
	item,
	implementation,
}) => {
	const [open, setOpen] = useState(false);
	const useTrigger = implementation.useTrigger ?? NO_TRIGGER;
	const trigger = useTrigger();
	if (trigger.hidden) return null;
	const { Content } = implementation;
	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger render={<Button type="button" {...triggerProps(item, trigger)} />}>
				<TriggerContent trigger={trigger} />
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align={item.metadata.align}
				className="w-80"
				data-qa-id={`shell-status-bar-popover-${item.id}`}
			>
				<Content close={() => setOpen(false)} />
			</PopoverContent>
		</Popover>
	);
};
