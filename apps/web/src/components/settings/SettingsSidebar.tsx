import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { resolvePluginNavIcon } from "@/features/plugin-icons";
import { useVisiblePluginSettings, type PluginSettingsSection } from "@/features/plugin-settings";
import {
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarSearch,
} from "@anaconda-agentic-desktop/ui/components/sidebar";

const EMPTY_SECTIONS: readonly PluginSettingsSection[] = [];

type SettingsSidebarProps = {
	/** Injectable for tests; the app shell passes bundled plugin settings sections. */
	sections?: readonly PluginSettingsSection[];
};

/**
 * Replaces the app siderail while `/settings` is active: back to the app,
 * optional section search, and the settings section list. Not a nested nav
 * inside the content pane.
 *
 * Root `px-2` and the back+search stack (`gap-0.5`, shared `SidebarSearch`)
 * match the sidebar ZoneOutlet / New + Search so the rail does
 * not jump on enter/leave.
 */
export function SettingsSidebar({ sections = EMPTY_SECTIONS }: SettingsSidebarProps) {
	const visible = useVisiblePluginSettings(sections);
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const [query, setQuery] = useState("");
	const needle = query.trim().toLowerCase();
	const filtered =
		needle === ""
			? visible
			: visible.filter((section) => section.title.toLowerCase().includes(needle));

	return (
		<div className="flex min-h-0 flex-1 flex-col px-2" data-qa-id="settings-sidebar">
			<div className="flex flex-col gap-0.5">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip="Back to app"
							render={<Link to="/" />}
							data-qa-id="settings-back"
						>
							<ArrowLeftIcon />
							<span>Back to app</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
				{visible.length > 0 ? (
					<SidebarSearch
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
						aria-label="Search settings"
						placeholder="Search settings"
						data-qa-id="settings-search"
					/>
				) : null}
			</div>
			{filtered.length > 0 ? (
				<>
					<SidebarGroupLabel
						className="text-sidebar-foreground/60 mt-3 mb-1 h-auto px-2 py-1 text-xs font-medium"
						data-qa-id="settings-group-personal"
					>
						Personal
					</SidebarGroupLabel>
					<SidebarMenu
						className="min-h-0 flex-1 gap-0.5 overflow-y-auto"
						data-qa-id="settings-section-nav"
						aria-label="Settings sections"
					>
						{filtered.map((section) => {
							const Icon = resolvePluginNavIcon(section.icon, section.iconComponent);
							const href = `/settings/${section.id}`;
							return (
								<SidebarMenuItem key={section.id}>
									<SidebarMenuButton
										isActive={pathname === href}
										tooltip={section.title}
										render={<Link to="/settings/$section" params={{ section: section.id }} />}
										className="h-9 rounded-lg"
										data-qa-id={`settings-section-${section.id}`}
									>
										<Icon />
										<span>{section.title}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							);
						})}
					</SidebarMenu>
				</>
			) : null}
		</div>
	);
}
