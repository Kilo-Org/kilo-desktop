import type { ComponentType } from "react";

import {
	findSettingsSection,
	PLUGIN_SETTINGS,
	type PluginSettingsSection,
} from "@/features/plugin-settings";
import { isDesktopBridgeAvailable } from "@/platform/desktopBridge";

type SettingsSectionViewProps = {
	sectionId: string;
	/** Injectable for tests; defaults to bundled plugin settings sections. */
	sections?: readonly PluginSettingsSection[];
	desktopAvailable?: boolean;
};

/**
 * Mounts the settings section whose `id` matches `sectionId`. Unknown ids
 * render a not-found pane; Electron-only sections in browser mode render an
 * unavailable pane. Flag-gated sections still mount on a direct visit.
 */
export function SettingsSectionView({
	sectionId,
	sections = PLUGIN_SETTINGS,
	desktopAvailable = isDesktopBridgeAvailable(),
}: SettingsSectionViewProps) {
	const section = findSettingsSection(sections, sectionId);

	if (!section) {
		return (
			<div className="mx-auto max-w-xl px-5 py-8">
				<h1
					className="text-2xl font-semibold tracking-tight"
					data-qa-id="settings-section-not-found"
				>
					Section not found
				</h1>
				<p className="text-muted-foreground mt-1 text-sm">
					No plugin provides a settings section named{" "}
					<code className="bg-muted rounded px-1">{sectionId}</code>.
				</p>
			</div>
		);
	}

	if (!section.browserSafe && !desktopAvailable) {
		return (
			<div className="mx-auto max-w-xl px-5 py-8">
				<h1 className="text-2xl font-semibold tracking-tight" data-qa-id="settings-section-heading">
					{section.title}
				</h1>
				<p className="text-muted-foreground mt-1 text-sm" data-qa-id="settings-section-unavailable">
					{section.title} is not available in browser mode. Run the desktop app to use this feature.
				</p>
			</div>
		);
	}

	const Panel = section.component as ComponentType;
	return <Panel />;
}
