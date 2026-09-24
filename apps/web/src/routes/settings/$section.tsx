import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { SettingsSectionView } from "@/components/settings/SettingsSectionView";
import { findSettingsSection } from "@/features/plugin-settings";
import { PLUGIN_SETTINGS } from "@/features/plugin-settings-entries";
import { writeLastSettingsSection } from "@/features/settings-last-section";

export const Route = createFileRoute("/settings/$section")({
	validateSearch: (search: Record<string, unknown>): { catalogModel?: string } => {
		const catalogModel = search.catalogModel;
		return catalogModel == null || catalogModel === ""
			? {}
			: { catalogModel: String(catalogModel) };
	},
	component: SettingsSectionRoute,
});

function SettingsSectionRoute() {
	const { section } = Route.useParams();
	useEffect(() => {
		if (findSettingsSection(PLUGIN_SETTINGS, section)) writeLastSettingsSection(section);
	}, [section]);
	return <SettingsSectionView sectionId={section} sections={PLUGIN_SETTINGS} />;
}
