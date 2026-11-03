import { definePlugin } from "@kilo-desktop/kernel";
import { InteractionRenderer, McpApp } from "@kilo-desktop/plugin-chat/contracts";
import { Navigation, SettingsSection } from "@kilo-desktop/plugin-shell/contracts";

import { Conda, ENVIRONMENTS_SETTINGS_SECTION } from "../contracts/index.js";
import { EnvironmentsNavIcon } from "./EnvironmentsNavIcon.js";
import { EnvironmentsPage } from "./EnvironmentsPage.js";
import {
	condaCliInteractions,
	condaToolInteractions,
	localFileAnswerInteractions,
} from "./interactions/conda-interactions.js";
import { loadEnvsListApp } from "./mcp-app.js";

export { EnvironmentsNavIcon } from "./EnvironmentsNavIcon.js";
export { EnvironmentsPage } from "./EnvironmentsPage.js";

/**
 * kilo.environments' renderer entry: the Conda Environments settings page,
 * the conda environments widget for `conda.envs.list` calls, the conda
 * details and "per action only" rule on chat's permission cards, warnings on
 * agent answers that install a local package file, and opening the settings
 * page when the agent asks (main window only).
 */
export const environmentsWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(SettingsSection, ENVIRONMENTS_SETTINGS_SECTION, {
			component: EnvironmentsPage,
			icon: EnvironmentsNavIcon,
		});
		sdk.extensions.implement(McpApp, "envs-list", { loadHtml: loadEnvsListApp });
		sdk.extensions.implement(InteractionRenderer, "conda-tools", condaToolInteractions);
		sdk.extensions.implement(InteractionRenderer, "conda-cli", condaCliInteractions);
		sdk.extensions.implement(
			InteractionRenderer,
			"local-file-answers",
			localFileAnswerInteractions,
		);

		let stopFollowing: (() => void) | undefined;
		sdk.onDispose(
			sdk.domains.track(Conda, {
				added: (conda) => {
					stopFollowing = conda.on("setup-requested", () => {
						if (sdk.context.get("kernel/secondaryWindow")) return;
						void sdk.domains
							.get(Navigation)
							?.methods.openSettings({ section: ENVIRONMENTS_SETTINGS_SECTION })
							.catch(() => undefined);
					});
				},
				removed: () => stopFollowing?.(),
			}),
		);
		sdk.onDispose(() => stopFollowing?.());
	},
});
