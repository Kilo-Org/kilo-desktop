import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";
import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";

import { AboutSection } from "../../../contracts";

/**
 * Settings → About: the page header, then the blocks contributed to
 * `kilo.shell/about-section` in priority order. kilo.shell's own Support
 * block is one of them, so other plugins can sit above or below it.
 */
export function AboutSettings() {
	const sections = useExtensions(AboutSection);

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="about-settings">
			<SettingsPageHeader />
			{sections.map((section) => (
				<RenderContribution key={section.key} contribution={section} />
			))}
		</div>
	);
}
