import { OrbitIcon } from "lucide-react";

import { definePlugin } from "@kilo-desktop/kernel";
import { RightSidebarPanel } from "@kilo-desktop/plugin-shell/contracts";

import { DomainMapPanel } from "./map/DomainMapPanel";
import { mapPreferences } from "./map/preferences";

/**
 * kilo.domain-map's renderer entry: the Domain Map as a panel in the shell's
 * right sidebar, behind the `developer` flag (its manifest `when`).
 */
export const domainMapWebEntry = definePlugin({
	activate(sdk) {
		// The map's view preferences start fresh each time the plugin starts.
		mapPreferences.reset();
		sdk.extensions.implement(RightSidebarPanel, "domain-map", {
			component: DomainMapPanel,
			icon: OrbitIcon,
		});
	},
});
