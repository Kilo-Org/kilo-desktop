import { ChevronDownIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";

interface CollapseDiffButtonProps {
	readonly collapsed: boolean;
	readonly disabled: boolean;
	readonly onToggle: () => void;
}

export function CollapseDiffButton({ collapsed, disabled, onToggle }: CollapseDiffButtonProps) {
	return (
		<Button
			type="button"
			aria-expanded={!disabled && !collapsed}
			aria-label={collapsed ? "Expand diff" : "Collapse diff"}
			className="ml-[-8px]"
			data-qa-id="git-diff-file-collapse"
			disabled={disabled}
			size="icon-sm"
			variant="ghost"
			onClick={(event) => {
				event.preventDefault();
				event.stopPropagation();
				onToggle();
			}}
		>
			<ChevronDownIcon
				aria-hidden="true"
				className={cn("transition-transform", (disabled || collapsed) && "-rotate-90")}
			/>
		</Button>
	);
}
