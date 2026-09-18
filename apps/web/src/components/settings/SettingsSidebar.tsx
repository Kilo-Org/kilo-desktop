import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { HOME_PLUGIN_SPLAT } from "@/features/home-route";
import { resolvePluginNavIcon } from "@/features/plugin-icons";
import { useVisiblePluginSettings, type PluginSettingsSection } from "@/features/plugin-settings";
import {
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarSearch,
} from "@kilo-desktop/ui/components/sidebar";

const EMPTY_SECTIONS: readonly PluginSettingsSection[] = [];

type SettingsSidebarProps = {
	/** Injectable for tests; the app shell passes bundled plugin settings sections. */
	sections?: readonly PluginSettingsSection[];
};

type SettingsCategory = {
	name: string;
	sections: PluginSettingsSection[];
};

function groupByCategory(sections: readonly PluginSettingsSection[]): SettingsCategory[] {
	const groups = new Map<string, PluginSettingsSection[]>();
	for (const section of sections) {
		const categorySections = groups.get(section.category);
		if (categorySections === undefined) {
			groups.set(section.category, [section]);
		} else {
			categorySections.push(section);
		}
	}
	return [...groups].map(([name, categorySections]) => ({ name, sections: categorySections }));
}

function categoryQaId(category: string): string {
	return category
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
}

/**
 * Replaces the app siderail while `/settings` is active: back to the app,
 * optional section search, and the settings section list. Not a nested nav
 * inside the content pane.
 *
 * Root padding and the back/search stack match the primary sidebar contribution
 * so equivalent controls stay aligned when navigating between app settings and
 * the main sidebar.
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
	const categories = groupByCategory(filtered);

	return (
		<div className="flex min-h-0 flex-1 flex-col px-2" data-qa-id="settings-sidebar">
			<div className="mb-3 flex flex-col gap-0.5 [&_[data-sidebar=search]]:gap-2">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip="Back to app"
							render={<Link to="/plugins/$" params={{ _splat: HOME_PLUGIN_SPLAT }} />}
							data-qa-id="settings-back"
							className="gap-2"
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
				<div
					className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
					data-qa-id="settings-section-nav"
					aria-label="Settings sections"
				>
					{categories.map((category) => (
						<div key={category.name} className="flex flex-col gap-px">
							<SidebarGroupLabel
								className="text-sidebar-foreground/60 h-7 px-2 text-sm font-medium"
								data-qa-id={`settings-group-${categoryQaId(category.name)}`}
							>
								{category.name}
							</SidebarGroupLabel>
							<SidebarMenu className="gap-px">
								{category.sections.map((section) => {
									const Icon = resolvePluginNavIcon(section.icon, section.iconComponent);
									const href = `/settings/${section.id}`;
									return (
										<SidebarMenuItem key={section.id}>
											<SidebarMenuButton
												isActive={pathname === href}
												tooltip={section.title}
												render={<Link to="/settings/$section" params={{ section: section.id }} />}
												className="data-active:bg-foreground/5 data-active:hover:bg-foreground/5 gap-2 rounded-lg"
												data-qa-id={`settings-section-${section.id}`}
											>
												<Icon />
												<span>{section.title}</span>
											</SidebarMenuButton>
										</SidebarMenuItem>
									);
								})}
							</SidebarMenu>
						</div>
					))}
				</div>
			) : null}
		</div>
	);
}
