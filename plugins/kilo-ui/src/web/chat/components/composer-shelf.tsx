import type { ComponentProps, ReactNode } from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@kilo-desktop/ui/lib/utils";

/*
 * Composer glass surfaces (see composer.css). The transparent `border` keeps
 * these the same box size as the composer, whose stroke is the glass outline.
 *
 * - Shelf: a collapsible tray stacked above the composer (tasks, queue,
 *   checkpoint restore).
 * - Shell: a card that stands in for the composer while the agent waits on
 *   the user (permission, question, suggestion).
 */
export const COMPOSER_SHELF_CLASS =
	"chat-composer-glass chat-composer-surface shadow-composer-shelf flex w-full flex-col overflow-hidden rounded-xl border";

const COMPOSER_SHELL_CLASS =
	"chat-composer-glass chat-composer-surface shadow-composer flex w-full flex-col rounded-(--composer-radius) border";

export function ComposerShelf({ className, ...props }: ComponentProps<"div">) {
	return <div className={cn(COMPOSER_SHELF_CLASS, className)} {...props} />;
}

type ComposerShelfToggleProps = Omit<ComponentProps<"button">, "type"> & {
	collapsed: boolean;
	/** Right-aligned content before the chevron (e.g. a count). */
	trailing?: ReactNode;
};

/** The shelf's 32px header row; its trailing chevron shows the collapse state. */
export function ComposerShelfToggle({
	collapsed,
	trailing,
	className,
	children,
	...props
}: ComposerShelfToggleProps) {
	return (
		<button
			type="button"
			aria-expanded={!collapsed}
			className={cn(
				"text-muted-foreground hover:bg-muted focus-visible:ring-ring/50 flex h-8 w-full items-center justify-between px-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2",
				!collapsed && "border-border-subtle border-b",
				className,
			)}
			{...props}
		>
			{children}
			<span className="flex items-center gap-2">
				{trailing}
				<ChevronDownIcon
					aria-hidden="true"
					className={cn("size-3.5 transition-transform duration-150", collapsed && "-rotate-90")}
				/>
			</span>
		</button>
	);
}

export function ComposerShell({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			data-slot="aui_composer-shell"
			className={cn(COMPOSER_SHELL_CLASS, className)}
			{...props}
		/>
	);
}
