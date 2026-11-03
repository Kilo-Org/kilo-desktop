import { InfoIcon } from "lucide-react";

import { definePlugin } from "@kilo-desktop/kernel";
import { SettingsSection, LeftSidebarNotice } from "@kilo-desktop/plugin-shell/contracts";

import { AboutSettings } from "./AboutSettings";
import { SidebarUpdatePill } from "./SidebarUpdatePill";

/** kilo.updates' renderer entry: About settings and the update-ready notice. */
export const updatesWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(SettingsSection, "about", {
			component: AboutSettings,
			icon: InfoIcon,
		});
		sdk.extensions.implement(LeftSidebarNotice, "update-ready", SidebarUpdatePill);
	},
});
