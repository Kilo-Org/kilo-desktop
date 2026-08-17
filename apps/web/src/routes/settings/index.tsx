import { createFileRoute, Navigate } from "@tanstack/react-router";

import { SettingsEmptyState } from "@/components/settings/SettingsEmptyState";
import { useVisiblePluginSettings } from "@/features/plugin-settings";
import { PLUGIN_SETTINGS } from "@/features/plugin-settings-entries";

export const Route = createFileRoute("/settings/")({
	component: SettingsIndex,
});

function SettingsIndex() {
	const visible = useVisiblePluginSettings(PLUGIN_SETTINGS);
	const first = visible[0];
	if (first === undefined) return <SettingsEmptyState />;
	return <Navigate to="/settings/$section" params={{ section: first.id }} />;
}
