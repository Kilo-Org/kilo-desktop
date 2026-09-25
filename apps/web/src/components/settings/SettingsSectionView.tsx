import type { ComponentType, ReactNode } from "react";

import { SettingsPageHeader, SettingsSectionProvider } from "@kilo-desktop/sdk-react";

import { findSettingsSection, type PluginSettingsSection } from "@/features/plugin-settings";
import { isDesktopBridgeAvailable } from "@/platform/desktopBridge";

type SettingsSectionViewProps = {
	sectionId: string;
	sections: readonly PluginSettingsSection[];
	desktopAvailable?: boolean;
};

/**
 * Mounts the settings section whose `id` matches `sectionId`, providing its
 * entry's title and description as the defaults for the section's
 * `SettingsPageHeader`. Unknown ids render a not-found pane; Electron-only
 * sections in browser mode render an unavailable pane. Flag-gated sections
 * still mount on a direct visit.
 */
export function SettingsSectionView({
	sectionId,
	sections,
	desktopAvailable = isDesktopBridgeAvailable(),
}: SettingsSectionViewProps) {
	const section = findSettingsSection(sections, sectionId);

	if (!section) {
		return (
			<SettingsSectionFrame>
				<SettingsPageHeader
					title="Section not found"
					titleQaId="settings-section-not-found"
					description={
						<>
							No plugin provides a settings section named{" "}
							<code className="bg-muted rounded-sm px-1">{sectionId}</code>.
						</>
					}
				/>
			</SettingsSectionFrame>
		);
	}

	if (!section.browserSafe && !desktopAvailable) {
		return (
			<SettingsSectionFrame>
				<SettingsPageHeader
					title={section.title}
					description={
						<span data-qa-id="settings-section-unavailable">
							{section.title} is not available in browser mode. Run the desktop app to use this
							feature.
						</span>
					}
				/>
			</SettingsSectionFrame>
		);
	}

	const Panel = section.component as ComponentType;
	return (
		<SettingsSectionFrame>
			<SettingsSectionProvider value={{ title: section.title, description: section.description }}>
				<Panel />
			</SettingsSectionProvider>
		</SettingsSectionFrame>
	);
}

function SettingsSectionFrame({ children }: { children: ReactNode }) {
	return (
		// Sections that manage their own scrolling (a bounded list) mark their
		// root `data-settings-fill`; only then is the frame capped at the pane
		// height. Others grow with their content so the pane's padding survives.
		<div className="mx-auto flex w-full max-w-3xl min-w-0 flex-1 flex-col has-[[data-settings-fill]]:min-h-0">
			{children}
		</div>
	);
}
