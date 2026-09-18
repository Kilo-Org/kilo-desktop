import { createFileRoute } from "@tanstack/react-router";

import { SettingsSectionView } from "@/components/settings/SettingsSectionView";
import { PLUGIN_SETTINGS } from "@/features/plugin-settings-entries";

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
	return <SettingsSectionView sectionId={section} sections={PLUGIN_SETTINGS} />;
}
