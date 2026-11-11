import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";

import type { Contribution } from "@kilo-desktop/kernel";
import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";
import { Button } from "@kilo-desktop/ui/components/button";
import { useSidebar } from "@kilo-desktop/ui/components/sidebar";
import { ToggleGroup, ToggleGroupItem } from "@kilo-desktop/ui/components/toggle-group";

import { RightSidebarPanel, type RightSidebarPanelImplementation } from "../../contracts";
import { useRightSidebar, useShellUi } from "./ui-state";

type Panel = Contribution<typeof RightSidebarPanel>;

const selectComponent = (implementation: RightSidebarPanelImplementation) =>
	implementation.component;

function useCurrentPanel(): { panels: readonly Panel[]; current: Panel | undefined } {
	const panels = useExtensions(RightSidebarPanel);
	const { selected } = useRightSidebar();
	return { panels, current: panels.find((panel) => panel.key === selected) ?? panels[0] };
}

/** Whether the top bar shows the toggle: while the right sidebar is closed and has panels. */
export function useRightSidebarToggleShown(): boolean {
	const { open } = useRightSidebar();
	const { panels } = useCurrentPanel();
	return !open && panels.length > 0;
}

/** Opens the right sidebar; the top bar shows it while `useRightSidebarToggleShown`. */
export function RightSidebarToggle() {
	const ui = useShellUi();
	return (
		<Button
			variant="ghost"
			size="icon-sm"
			aria-label="Show right sidebar"
			data-qa-id="right-sidebar-open"
			onClick={() => ui.setRightSidebar({ open: true })}
		>
			<PanelRightOpenIcon />
		</Button>
	);
}

/**
 * The right sidebar: the `right-sidebar-panel` contributions, one at a time,
 * chosen from its header. Absent while no panel is available or after the
 * person closes it; which panel shows and whether it is open are this
 * window's alone.
 */
export function RightSidebar({ topBarEmpty }: { readonly topBarEmpty: boolean }) {
	const ui = useShellUi();
	const docked = useSidebar().open;
	const { open } = useRightSidebar();
	const { panels, current } = useCurrentPanel();
	if (!open || !current) return null;

	return (
		<aside
			aria-label="Right sidebar"
			data-qa-id="right-sidebar"
			// Level with the main pane, which moves up while the top bar is collapsed.
			data-top-bar-collapsed={(topBarEmpty && docked) || undefined}
			className="bg-card pane-edge mt-[calc(var(--shell-titlebar-height)+0.5rem)] mr-2 mb-2 flex w-80 shrink-0 flex-col overflow-hidden rounded-lg transition-[margin-top] duration-150 ease-out data-top-bar-collapsed:mt-[max(0.5rem,env(titlebar-area-height,0px))] motion-reduce:transition-none"
		>
			<header className="flex h-10 shrink-0 items-center gap-2 border-b px-2">
				{panels.length > 1 ? (
					<ToggleGroup
						value={[current.key]}
						onValueChange={(value) => {
							const [selected] = value as string[];
							if (selected) ui.setRightSidebar({ selected });
						}}
						size="sm"
						aria-label="Right sidebar panels"
						className="min-w-0 flex-1"
					>
						{panels.map((panel) => (
							<PanelChoice key={panel.key} panel={panel} />
						))}
					</ToggleGroup>
				) : (
					<h2 className="min-w-0 flex-1 truncate px-1 text-sm font-medium">
						{current.metadata.title}
					</h2>
				)}
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Hide right sidebar"
					data-qa-id="right-sidebar-close"
					onClick={() => ui.setRightSidebar({ open: false })}
				>
					<PanelRightCloseIcon />
				</Button>
			</header>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-qa-id="right-sidebar-body">
				<RenderContribution key={current.key} contribution={current} select={selectComponent} />
			</div>
		</aside>
	);
}

function PanelChoice({ panel }: { readonly panel: Panel }) {
	const Icon = (panel.implementation as RightSidebarPanelImplementation | undefined)?.icon;
	return (
		<ToggleGroupItem
			value={panel.key}
			aria-label={panel.metadata.title}
			title={panel.metadata.title}
			data-qa-id={`right-sidebar-panel-${panel.key}`}
		>
			{Icon ? <Icon /> : <span className="truncate">{panel.metadata.title}</span>}
		</ToggleGroupItem>
	);
}
