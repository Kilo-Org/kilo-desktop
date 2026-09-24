import { createFileRoute, Navigate } from "@tanstack/react-router";

import { SettingsEmptyState } from "@/components/settings/SettingsEmptyState";
import { useVisiblePluginSettings } from "@/features/plugin-settings";
import { PLUGIN_SETTINGS } from "@/features/plugin-settings-entries";
import {
	readLastSettingsSection,
	resolveSettingsLandingSection,
} from "@/features/settings-last-section";

export const Route = createFileRoute("/settings/")({
	component: SettingsIndex,
});

function SettingsIndex() {
	const visible = useVisiblePluginSettings(PLUGIN_SETTINGS);
	const landing = resolveSettingsLandingSection(visible, readLastSettingsSection());
	if (landing === undefined) return <SettingsEmptyState />;
	return <Navigate to="/settings/$section" params={{ section: landing.id }} />;
}
