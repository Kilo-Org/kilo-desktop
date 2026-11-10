import { definePlugin } from "@kilo-desktop/kernel";
import { PermissionRenderer } from "@kilo-desktop/plugin-chat/contracts";
import { SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

import { ENVIRONMENTS_SETTINGS_SECTION, PERMISSION_RENDERERS } from "../contracts/index";
import { EnvironmentsNavIcon } from "./EnvironmentsNavIcon";
import { EnvironmentsPage } from "./EnvironmentsPage";
import {
	condaCliInteractions,
	condaToolInteractions,
	localFileAnswerInteractions,
} from "./interactions/conda-interactions";

export { EnvironmentsNavIcon } from "./EnvironmentsNavIcon";
export { EnvironmentsPage } from "./EnvironmentsPage";

/**
 * kilo.environments' renderer entry: the Conda Environments settings page,
 * the conda details and "per action only" rule on chat's permission cards,
 * and warnings on agent answers that install a local package file. Opening
 * the settings page for the agent happens in main, through kilo.shell's
 * navigation.
 */
export const environmentsWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(SettingsSection, ENVIRONMENTS_SETTINGS_SECTION, {
			component: EnvironmentsPage,
			icon: EnvironmentsNavIcon,
		});
		sdk.extensions.implement(
			PermissionRenderer,
			PERMISSION_RENDERERS.condaTools,
			condaToolInteractions,
		);
		sdk.extensions.implement(
			PermissionRenderer,
			PERMISSION_RENDERERS.condaCli,
			condaCliInteractions,
		);
		sdk.extensions.implement(
			PermissionRenderer,
			PERMISSION_RENDERERS.localFileAnswers,
			localFileAnswerInteractions,
		);
	},
});
