import { createFileRoute } from "@tanstack/react-router";

import { SettingsSectionView } from "@/components/settings/SettingsSectionView";
import { PLUGIN_SETTINGS } from "@/features/plugin-settings-entries";

export const Route = createFileRoute("/settings/$section")({
	component: SettingsSectionRoute,
});

function SettingsSectionRoute() {
	const { section } = Route.useParams();
	return <SettingsSectionView sectionId={section} sections={PLUGIN_SETTINGS} />;
}
