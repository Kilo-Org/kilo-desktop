import { definePlugin } from "@kilo-desktop/kernel";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";
import { StoreIcon } from "lucide-react";

import { MARKETPLACE_SETTINGS_SECTION } from "../contracts/index";
import { MarketplaceSettings } from "./MarketplaceSettings";

export { MarketplaceSettings } from "./MarketplaceSettings";

/** kilo.marketplace's renderer entry: the Agent Behavior settings section. */
export const marketplaceWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(SettingsSection, MARKETPLACE_SETTINGS_SECTION, {
			component: MarketplaceSettings,
			icon: StoreIcon,
		});
	},
});
