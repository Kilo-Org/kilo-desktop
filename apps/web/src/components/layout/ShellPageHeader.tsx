import { motion, useTransform } from "motion/react";
import type { ComponentType } from "react";

import {
	PAGE_HEADER_ACTIONS_ZONE,
	type PluginPageProps,
} from "@anaconda-agentic-desktop/feature-sdk";
import { SidebarTrigger, useSidebar } from "@anaconda-agentic-desktop/ui/components/sidebar";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";

import { ZoneOutlet } from "@/components/zones/ZoneOutlet";

type ShellPageHeaderProps = {
	title?: string | undefined;
	leading?: ComponentType<PluginPageProps> | undefined;
	actions?: ComponentType<PluginPageProps> | undefined;
	pageProps: PluginPageProps;
};

function ShellSidebarToggle({ open }: { open: boolean }) {
	const label = open ? "Hide navigation" : "Show navigation";

	return (
		<div
			className="pointer-events-auto fixed top-0 z-[60] flex h-12 items-center [-webkit-app-region:no-drag]"
			style={{ left: "var(--shell-sidebar-toggle-left)" }}
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<SidebarTrigger
							aria-label="Toggle navigation"
							aria-pressed={open}
							data-qa-id="sidebar-nav-toggle"
							className="[-webkit-app-region:no-drag]"
						/>
					}
				/>
				<TooltipContent side="bottom">{label}</TooltipContent>
			</Tooltip>
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
	const paddingLeft = useTransform(
		progress,
		(value) => `calc((var(--shell-sidebar-toggle-left, 0.75rem) + 1.25rem) * ${1 - value})`,
	);
	const Leading = leading;
	const Actions = actions;

	return (
		<header
			className="drag-region border-border bg-background dark:border-muted-foreground/15 flex h-12 shrink-0 items-center border-b pr-[calc(0.75rem+env(titlebar-area-width,0px))] pl-3"
			data-qa-id="shell-page-header"
		>
			<ShellSidebarToggle open={open} />
			<motion.div className="flex min-w-0 flex-1 items-center gap-2" style={{ paddingLeft }}>
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
