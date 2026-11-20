import { RenderContribution, useExtensions } from "@kilo-desktop/kernel/web";

import { ShortcutsPanel, type ShortcutsPanelImplementation } from "../../contracts";

const selectComponent = (implementation: ShortcutsPanelImplementation) => implementation.component;

/** Panels plugins contribute (`kilo.shell/shortcuts-panel`), above the list. */
export function ShortcutsPanels() {
	return useExtensions(ShortcutsPanel).map((panel) => (
		<section
			key={panel.key}
			aria-label={panel.metadata.title}
			data-qa-id={`shortcuts-panel-${panel.key}`}
		>
			<RenderContribution contribution={panel} select={selectComponent} />
		</section>
	));
}
