import { createFileRoute } from "@tanstack/react-router";

import { SettingsSectionView } from "@/components/settings/SettingsSectionView";

export const Route = createFileRoute("/settings/$section")({
	component: SettingsSectionRoute,
});

function SettingsSectionRoute() {
	const { section } = Route.useParams();
	return <SettingsSectionView sectionId={section} />;
}
