import { motion, useTransform } from "motion/react";
import type { ComponentType } from "react";

import { PAGE_HEADER_ACTIONS_ZONE, type PluginPageProps } from "@kilo-desktop/feature-sdk";
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
			className="pointer-events-auto fixed top-0 z-40 flex h-12 items-center [-webkit-app-region:no-drag]"
			style={{ left: "var(--shell-sidebar-toggle-left)" }}
		>
			<SidebarTrigger
				aria-label="Toggle navigation"
				aria-pressed={open}
				data-qa-id="sidebar-nav-toggle"
				className="[-webkit-app-region:no-drag]"
			/>
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
	const contentMarginLeft = useTransform(
		progress,
		(value) => `calc((var(--shell-sidebar-toggle-left, 0.75rem) + 1.25rem) * ${1 - value})`,
	);
	const Leading = leading;
	const Actions = actions;

	return (
		<header
			className="border-border bg-background flex h-12 shrink-0 items-center border-b pr-[calc(0.75rem+var(--window-controls-width))] pl-3"
			data-qa-id="shell-page-header"
		>
			<ShellSidebarToggle open={open} />
			<motion.div
				className="drag-region flex h-full min-w-0 flex-1 items-center gap-2"
				style={{ marginLeft: contentMarginLeft }}
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
