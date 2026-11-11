import { motion, useTransform } from "motion/react";

import type { Contribution } from "@kilo-desktop/kernel";
import { RenderContribution } from "@kilo-desktop/kernel/web";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { SidebarTrigger, useSidebar } from "@kilo-desktop/ui/components/sidebar";

import type { MainImplementation } from "../../contracts";
import { RightSidebarToggle } from "./RightSidebar";

const selectLeading = (implementation: MainImplementation) => implementation.headerLeading;
const selectActions = (implementation: MainImplementation) => implementation.headerActions;

function SidebarToggle({ open }: { readonly open: boolean }) {
	return (
		<div
			className="titlebar-row pointer-events-auto fixed top-0 z-40 flex items-center gap-1.5 [-webkit-app-region:no-drag]"
			style={{ left: "var(--shell-sidebar-toggle-left)" }}
		>
			<SidebarTrigger
				aria-label="Toggle navigation"
				aria-pressed={open}
				data-qa-id="sidebar-nav-toggle"
				className="[-webkit-app-region:no-drag]"
			/>
			<Badge
				className="bg-primary-brand-badge text-primary-brand-badge-foreground h-4 px-1.5 text-[10px] font-bold tracking-wide uppercase"
				data-qa-id="sidebar-beta-badge"
			>
				Beta
			</Badge>
		</div>
	);
}

/**
 * Window-level page chrome: the drag region, the sidebar toggle's clearance,
 * the page title (or the home view's own leading content) and header actions.
 * It keeps its full height whatever it holds: the top bar is part of the layout.
 */
export function PageHeader({
	title,
	leading,
	actions,
}: {
	readonly title?: string | undefined;
	/** The home contribution, when it supplies header content. */
	readonly leading?: Contribution | undefined;
	readonly actions?: Contribution | undefined;
}) {
	const { open, progress } = useSidebar();
	// While collapsed, clear the fixed toggle cluster; the header's own pl-5.5 covers part of it.
	const contentMarginLeft = useTransform(
		progress,
		(value) =>
			`calc((var(--shell-sidebar-toggle-left, 0.75rem) + var(--shell-sidebar-toggle-clearance, 2rem) - 1.375rem) * ${1 - value})`,
	);

	return (
		<header
			className="titlebar-row mb-2 flex shrink-0 items-center pr-[calc(0.75rem+var(--window-controls-width))] pl-5.5"
			data-qa-id="shell-page-header"
			data-sidebar-docked={open || undefined}
		>
			<SidebarToggle open={open} />
			<motion.div
				className="drag-region flex h-full min-w-0 flex-1 items-center gap-2 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
				style={{ marginLeft: contentMarginLeft }}
				data-shell-header-content
			>
				<div className="flex min-w-0 flex-1 items-center gap-1">
					{leading ? (
						<RenderContribution contribution={leading} select={selectLeading} />
					) : title ? (
						<h1 className="truncate text-sm font-medium" data-qa-id="shell-page-heading">
							{title}
						</h1>
					) : null}
				</div>
				<div className="ml-auto flex shrink-0 items-center justify-end gap-2 [-webkit-app-region:no-drag]">
					{actions ? <RenderContribution contribution={actions} select={selectActions} /> : null}
					<RightSidebarToggle />
				</div>
			</motion.div>
		</header>
	);
}
