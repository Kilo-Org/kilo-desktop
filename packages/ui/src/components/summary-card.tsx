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
				"group/summary-card relative min-w-0 flex-nowrap gap-2.5 rounded-none border-0 px-3 py-3",
				className,
			)}
			{...props}
		/>
	);
}

// Row targets (Trigger / Button) stretch an ::after overlay across the whole
// row so padding and gaps activate them too. Actions sit above the overlay and
// stay independently clickable, while gaps between them fall through to it.
const rowTargetClassName =
	"flex min-w-0 flex-1 items-center gap-2.5 text-left after:absolute after:inset-0";

/** Expands a collapsible row; must be rendered inside a `Collapsible`. */
function SummaryCardTrigger({ className, ...props }: ComponentProps<typeof CollapsibleTrigger>) {
	return (
		<CollapsibleTrigger
			data-summary-card-target=""
			className={cn(rowTargetClassName, className)}
			{...props}
		/>
	);
}

/** Makes the whole row activate one action, e.g. navigating to a detail view. */
function SummaryCardButton({ className, type = "button", ...props }: ComponentProps<"button">) {
	return (
		<button
			type={type}
			data-summary-card-target=""
			className={cn(rowTargetClassName, className)}
			{...props}
		/>
	);
}

function SummaryCardIcon({ className, ...props }: ComponentProps<typeof ItemMedia>) {
	return (
		<ItemMedia
			className={cn(
				"border-border bg-background flex size-8 shrink-0 self-center rounded-md border group-has-data-[slot=item-description]/item:!self-center group-has-data-[slot=item-description]/item:!translate-y-0 [&_svg:not([class*='size-'])]:size-[18px]",
				className,
			)}
			{...props}
		/>
	);
}

function SummaryCardContent({ className, ...props }: ComponentProps<typeof ItemContent>) {
	return (
		<ItemContent className={cn("min-w-0 gap-0.5 self-center leading-snug", className)} {...props} />
	);
}

function SummaryCardTitle({ className, ...props }: ComponentProps<typeof ItemTitle>) {
	return <ItemTitle className={cn("text-sm font-medium", className)} {...props} />;
}

function SummaryCardDescription({ className, ...props }: ComponentProps<typeof ItemDescription>) {
	return (
		<ItemDescription className={cn("line-clamp-1 text-sm leading-normal", className)} {...props} />
	);
}

function SummaryCardActions({ className, ...props }: ComponentProps<typeof ItemActions>) {
	return (
		<ItemActions
			className={cn(
				"ml-auto shrink-0 justify-end gap-2",
				"group-has-[[data-summary-card-target]]/summary-card:pointer-events-none group-has-[[data-summary-card-target]]/summary-card:relative group-has-[[data-summary-card-target]]/summary-card:z-10 [&>*]:pointer-events-auto",
				className,
			)}
			{...props}
		/>
	);
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
	Button: SummaryCardButton,
	Content: SummaryCardContent,
	Description: SummaryCardDescription,
	Icon: SummaryCardIcon,
	Row: SummaryCardRow,
	Title: SummaryCardTitle,
	Toggle: SummaryCardToggle,
	Trigger: SummaryCardTrigger,
};

export { SummaryCard };
