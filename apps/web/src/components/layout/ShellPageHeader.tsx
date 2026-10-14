import { motion, useTransform } from "motion/react";
import type { ComponentType } from "react";

import { PAGE_HEADER_ACTIONS_ZONE, type PluginPageProps } from "@kilo-desktop/feature-sdk";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { SidebarTrigger, useSidebar } from "@kilo-desktop/ui/components/sidebar";

import { ZoneOutlet } from "@/components/zones/ZoneOutlet";

type ShellPageHeaderProps = {
	title?: string | undefined;
	leading?: ComponentType<PluginPageProps> | undefined;
	actions?: ComponentType<PluginPageProps> | undefined;
	pageProps: PluginPageProps;
};

function ShellSidebarToggle({ open }: { open: boolean }) {
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
			<Badge variant="soft" data-qa-id="sidebar-beta-badge">
				Beta
			</Badge>
		</div>
	);
}

/**
 * Window-level page chrome owned by the shell. It owns Electron drag behavior,
 * sidebar-toggle clearance, route-scoped header components, and the app-wide
 * plugin action outlet; contributed page bodies remain unaware of this frame.
 */
export function ShellPageHeader({ title, leading, actions, pageProps }: ShellPageHeaderProps) {
	const { open, progress } = useSidebar();
	// While collapsed, clear the fixed toggle cluster; the header's own `pl-5.5`
	// (1.375rem) already covers part of that distance.
	const contentMarginLeft = useTransform(
		progress,
		(value) =>
			`calc((var(--shell-sidebar-toggle-left, 0.75rem) + var(--shell-sidebar-toggle-clearance, 2rem) - 1.375rem) * ${1 - value})`,
	);
	const Leading = leading;
	const Actions = actions;

	// pl-5.5 puts the leading icon over the first pane tab's icon: the 8px pane
	// gutter, the tab row's 6px inset, then the tab's own 8px padding.
	// mb-2 mirrors titlebar-row's 8px top padding so the row sits centred in the
	// 48px band above the pane, on the traffic-light line.
	return (
		<header
			className="titlebar-row empty-titlebar:h-[max(0.5rem,env(titlebar-area-height,0px))] empty-titlebar:pt-0 empty-titlebar:mb-0 empty-titlebar:[&>[data-shell-header-content]]:opacity-0 mb-2 flex shrink-0 items-center pr-[calc(0.75rem+var(--window-controls-width))] pl-5.5 transition-[height,padding-top,margin-bottom] duration-150 ease-out motion-reduce:transition-none"
			data-qa-id="shell-page-header"
			data-sidebar-docked={open || undefined}
		>
			<ShellSidebarToggle open={open} />
			<motion.div
				className="drag-region flex h-full min-w-0 flex-1 items-center gap-2 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
				style={{ marginLeft: contentMarginLeft }}
				data-shell-header-content
			>
				<div className="flex min-w-0 flex-1 items-center gap-1">
					{Leading ? (
						<Leading {...pageProps} />
					) : title ? (
						<h1 className="truncate text-sm font-medium" data-qa-id="shell-page-heading">
							{title}
						</h1>
					) : null}
				</div>
				<div className="ml-auto flex shrink-0 items-center justify-end gap-2 [-webkit-app-region:no-drag]">
					{Actions ? <Actions {...pageProps} /> : null}
					<ZoneOutlet
						zone={PAGE_HEADER_ACTIONS_ZONE}
						className="flex items-center justify-end gap-2"
					/>
				</div>
			</motion.div>
		</header>
	);
}
