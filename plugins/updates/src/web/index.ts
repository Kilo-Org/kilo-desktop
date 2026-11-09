import { definePlugin } from "@kilo-desktop/kernel";
import { AboutSection, LeftSidebarNotice } from "@kilo-desktop/plugin-shell/contracts";

import { AboutLegalSection } from "./AboutLegalSection";
import { AboutVersionSection } from "./AboutVersionSection";
import { SidebarUpdatePill } from "./SidebarUpdatePill";

/** kilo.updates' renderer entry: its blocks in Settings → About and the update-ready notice. */
export const updatesWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(AboutSection, "version", AboutVersionSection);
		sdk.extensions.implement(AboutSection, "legal", AboutLegalSection);
		sdk.extensions.implement(LeftSidebarNotice, "update-ready", SidebarUpdatePill);
	},
});
