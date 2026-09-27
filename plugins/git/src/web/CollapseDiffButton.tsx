import { ChevronDownIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import { cn } from "@kilo-desktop/ui/lib/utils";

const COLLAPSE_BUTTON_QA_ID = "git-diff-file-collapse";
const INTERACTIVE_SELECTOR = "a, button, input, select, textarea, [role='button']";

/**
 * Resolves a click anywhere on a file's diff header to that file's collapse
 * button, so the whole header toggles like the chevron. The header lives in
 * the diffs-container's open shadow root, so it is only reachable through
 * `composedPath()`; the button is slotted light DOM on the same host.
 * Clicks on other header controls, or that finish a text selection, are
 * left alone.
 */
export function collapseButtonForHeaderClick(event: MouseEvent): HTMLButtonElement | null {
	if (event.defaultPrevented || event.button !== 0) return null;
	if (document.getSelection()?.isCollapsed === false) return null;
	for (const node of event.composedPath()) {
		if (!(node instanceof Element)) continue;
		if (node.matches(INTERACTIVE_SELECTOR)) return null;
		if (!node.hasAttribute("data-diffs-header")) continue;
		const root = node.getRootNode();
		if (!(root instanceof ShadowRoot)) return null;
		return root.host.querySelector<HTMLButtonElement>(
			`[slot="header-prefix"] [data-qa-id="${COLLAPSE_BUTTON_QA_ID}"]`,
		);
	}
	return null;
}

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
			data-qa-id={COLLAPSE_BUTTON_QA_ID}
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
