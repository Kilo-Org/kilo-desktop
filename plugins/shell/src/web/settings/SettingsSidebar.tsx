import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeftIcon, PuzzleIcon } from "lucide-react";

import {
	SidebarGroupLabel,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarSearch,
} from "@kilo-desktop/ui/components/sidebar";

import type { SettingsSectionImplementation } from "../../contracts";
import { useSettingsGroups, useSettingsSections } from "./sections";

/**
 * Replaces the sidebar while Settings is open: back to the app, section
 * search and the sections plugins contribute, grouped by category.
 */
export function SettingsSidebar() {
	const sections = useSettingsSections();
	const pathname = useRouterState({ select: (state) => state.location.pathname });
	const [query, setQuery] = useState("");
	const needle = query.trim().toLowerCase();
	const filtered =
		needle === ""
			? sections
			: sections.filter((section) => section.metadata.title.toLowerCase().includes(needle));
	const groups = useSettingsGroups(filtered);

	return (
		<div className="flex min-h-0 flex-1 flex-col px-2" data-qa-id="settings-sidebar">
			<div className="mb-3 flex flex-col gap-0.5 [&_[data-sidebar=search]]:gap-2">
				<SidebarMenu>
					<SidebarMenuItem>
						<SidebarMenuButton
							tooltip="Back to app"
							render={<Link to="/" />}
							data-qa-id="settings-back"
							className="gap-2"
						>
							<ArrowLeftIcon />
							<span>Back to app</span>
						</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
				{sections.length > 0 ? (
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
					className="scroll-fade-y -mx-1 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-0.5"
					data-qa-id="settings-section-nav"
					aria-label="Settings sections"
				>
					{groups.map((category) => (
						<div key={category.key} className="flex flex-col gap-px">
							<SidebarGroupLabel
								className="text-sidebar-foreground/60 h-7 px-2 text-sm font-medium"
								data-qa-id={`settings-group-${category.id}`}
							>
								{category.title}
							</SidebarGroupLabel>
							<SidebarMenu className="gap-px">
								{category.sections.map((section) => {
									const Icon =
										(section.implementation as SettingsSectionImplementation | undefined)?.icon ??
										PuzzleIcon;
									return (
										<SidebarMenuItem key={section.key}>
											<SidebarMenuButton
												isActive={pathname === `/settings/${section.id}`}
												tooltip={section.metadata.title}
												render={<Link to={`/settings/${section.id}`} />}
												className="gap-2 rounded-lg"
												data-qa-id={`settings-section-${section.id}`}
											>
												<Icon />
												<span>{section.metadata.title}</span>
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
