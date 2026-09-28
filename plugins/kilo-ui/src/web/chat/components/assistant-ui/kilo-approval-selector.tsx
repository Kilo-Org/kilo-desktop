"use client";

import { ChevronDownIcon, FastForwardIcon, HandIcon, type LucideIcon } from "lucide-react";
import type { FC } from "react";

import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { useChatAutoApprove } from "../../auto-approve/ChatAutoApproveContext.js";
import { modelSelectorTriggerVariants } from "./model-selector.js";

type ApprovalMode = "manual" | "auto";

const APPROVAL_MODES: ReadonlyArray<{
	value: ApprovalMode;
	label: string;
	shortLabel: string;
	icon: LucideIcon;
}> = [
	{ value: "manual", label: "Manually approve", shortLabel: "Manual", icon: HandIcon },
	{ value: "auto", label: "Automatically approve", shortLabel: "Auto", icon: FastForwardIcon },
];

/** Composer permission-approval picker, styled like the agent selector. */
export const KiloApprovalSelector: FC = () => {
	const { enabled, setEnabled } = useChatAutoApprove();
	const mode: ApprovalMode = enabled ? "auto" : "manual";
	const selected = APPROVAL_MODES.find((entry) => entry.value === mode) ?? APPROVAL_MODES[0]!;
	const SelectedIcon = selected.icon;

	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				disabled={!setEnabled}
				className={cn(modelSelectorTriggerVariants({ variant: "ghost", size: "sm" }), "shrink-0")}
				data-qa-id="kilo-approval-selector-trigger"
				aria-label={`Approval mode: ${selected.shortLabel}`}
			>
				<span className="dark:text-foreground/90 flex min-w-0 items-center gap-1.5">
					<SelectedIcon className="size-3.5" />
					<span data-slot="composer-approval-label" className="whitespace-nowrap">
						{selected.shortLabel}
					</span>
				</span>
				<ChevronDownIcon className="size-4 opacity-50" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				side="bottom"
				className="w-max min-w-48"
				data-qa-id="kilo-approval-selector-content"
			>
				<DropdownMenuRadioGroup
					value={mode}
					onValueChange={(value) => setEnabled?.(value === "auto")}
				>
					{APPROVAL_MODES.map(({ value, label, icon: Icon }) => (
						<DropdownMenuRadioItem
							key={value}
							value={value}
							closeOnClick
							data-qa-id={`kilo-approval-selector-item-${value}`}
							className="gap-2"
						>
							<Icon className="size-3.5" />
							<span className="font-medium whitespace-nowrap">{label}</span>
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
