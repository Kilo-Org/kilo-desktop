import type { ComponentProps } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { CollapsibleTrigger } from "@kilo-desktop/ui/components/collapsible";
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemMedia,
	ItemTitle,
} from "@kilo-desktop/ui/components/item";
import { cn } from "@kilo-desktop/ui/lib/utils";

function SummaryCardRow({ className, ...props }: ComponentProps<typeof Item>) {
	return (
		<Item
			variant="default"
			size="xs"
			className={cn(
				"group/summary-card min-w-0 flex-nowrap gap-2.5 rounded-none border-0 px-3 py-2",
				className,
			)}
			{...props}
		/>
	);
}

function SummaryCardTrigger({ className, ...props }: ComponentProps<typeof CollapsibleTrigger>) {
	return (
		<CollapsibleTrigger
			className={cn("flex min-w-0 flex-1 items-center gap-2.5 text-left", className)}
			{...props}
		/>
	);
}

function SummaryCardIcon({ className, ...props }: ComponentProps<typeof ItemMedia>) {
	return (
		<ItemMedia
			className={cn(
				"border-border bg-background flex size-8 shrink-0 self-center rounded-md border group-has-data-[slot=item-description]/item:!self-center group-has-data-[slot=item-description]/item:!translate-y-0",
				className,
			)}
			{...props}
		/>
	);
}

function SummaryCardContent({ className, ...props }: ComponentProps<typeof ItemContent>) {
	return <ItemContent className={cn("min-w-0 gap-0 self-center", className)} {...props} />;
}

function SummaryCardTitle({ className, ...props }: ComponentProps<typeof ItemTitle>) {
	return <ItemTitle className={cn("text-sm leading-4 font-medium", className)} {...props} />;
}

function SummaryCardDescription({ className, ...props }: ComponentProps<typeof ItemDescription>) {
	return <ItemDescription className={cn("line-clamp-1 text-xs leading-4", className)} {...props} />;
}

function SummaryCardActions({ className, ...props }: ComponentProps<typeof ItemActions>) {
	return <ItemActions className={cn("ml-auto shrink-0 justify-end gap-2", className)} {...props} />;
}

type SummaryCardToggleProps = Omit<
	ComponentProps<typeof Button>,
	"aria-label" | "children" | "render" | "size" | "type" | "variant"
> & {
	label: string;
	open: boolean;
};

function SummaryCardToggle({ className, label, open, ...props }: SummaryCardToggleProps) {
	return (
		<CollapsibleTrigger
			render={
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					className={className}
					aria-label={label}
					{...props}
				/>
			}
		>
			<ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} />
		</CollapsibleTrigger>
	);
}

const SummaryCard = {
	Actions: SummaryCardActions,
	Content: SummaryCardContent,
	Description: SummaryCardDescription,
	Icon: SummaryCardIcon,
	Row: SummaryCardRow,
	Title: SummaryCardTitle,
	Toggle: SummaryCardToggle,
	Trigger: SummaryCardTrigger,
};

export { SummaryCard };
