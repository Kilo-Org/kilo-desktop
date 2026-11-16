import { motion, useTransform } from "motion/react";

import type { Contribution } from "@kilo-desktop/kernel";
import { RenderContribution, useContextKey } from "@kilo-desktop/kernel/web";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { SidebarTrigger, useSidebar } from "@kilo-desktop/ui/components/sidebar";

import { BETA_BADGES_FLAG, type TopBarAction, type TopBarTitle } from "../../contracts";

function SidebarToggle({ open }: { readonly open: boolean }) {
	const beta = useContextKey(`kernel/flag:${BETA_BADGES_FLAG}`);
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
			{beta ? (
				<Badge
					className="bg-primary-brand-badge text-primary-brand-badge-foreground h-4 px-1.5 text-[10px] font-bold tracking-wide uppercase"
					data-qa-id="sidebar-beta-badge"
				>
					Beta
				</Badge>
			) : null}
		</div>
	);
}

/**
 * The window's top bar: the drag region, the sidebar toggle's clearance, the
 * title (the `top-bar-title` winner, else the page's title), the
 * `top-bar-action`s and the right sidebar toggle. With nothing to show it
 * collapses to the pane gutter while the docked sidebar carries the window
 * controls; with the sidebar collapsed it keeps its height so the sidebar
 * toggle clears.
 */
export function TopBar({
	title,
	titleContribution,
	actions,
	empty,
}: {
	readonly title?: string | undefined;
	readonly titleContribution: Contribution<typeof TopBarTitle> | undefined;
	readonly actions: readonly Contribution<typeof TopBarAction>[];
	/** No title or actions: the bar collapses while the sidebar is docked. */
	readonly empty: boolean;
}) {
	const { open, progress } = useSidebar();
	// While collapsed, clear the fixed toggle cluster; the bar's own pl-5.5 covers part of it.
	const contentMarginLeft = useTransform(
		progress,
		(value) =>
			`calc((var(--shell-sidebar-toggle-left, 0.75rem) + var(--shell-sidebar-toggle-clearance, 2rem) - 1.375rem) * ${1 - value})`,
	);

	return (
		<header
			className="titlebar-row mb-2 flex shrink-0 items-center pr-[calc(0.75rem+var(--window-controls-width))] pl-5.5 transition-[height,padding-top,margin-bottom] duration-150 ease-out data-collapsed:mb-0 data-collapsed:h-[max(0.5rem,env(titlebar-area-height,0px))] data-collapsed:pt-0 motion-reduce:transition-none"
			data-qa-id="shell-top-bar"
			data-sidebar-docked={open || undefined}
			data-collapsed={(empty && open) || undefined}
		>
			<SidebarToggle open={open} />
			<motion.div
				className="drag-region flex h-full min-w-0 flex-1 items-center gap-2"
				style={{ marginLeft: contentMarginLeft }}
			>
				<div className="flex min-w-0 flex-1 items-center gap-1">
					{titleContribution ? (
						<RenderContribution contribution={titleContribution} />
					) : title ? (
						<h1 className="truncate text-sm font-medium" data-qa-id="shell-top-bar-title">
							{title}
						</h1>
					) : null}
				</div>
				<div className="ml-auto flex shrink-0 items-center justify-end gap-2 [-webkit-app-region:no-drag]">
					{actions.map((action) => (
						<RenderContribution key={action.key} contribution={action} />
					))}
				</div>
			</motion.div>
		</header>
	);
}
