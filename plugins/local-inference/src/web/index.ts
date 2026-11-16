import { definePlugin } from "@kilo-desktop/kernel";
import { ModelSource } from "@kilo-desktop/plugin-chat/contracts";
import { SettingsSection, StatusBarItem } from "@kilo-desktop/plugin-shell/contracts";
import { ServerIcon } from "lucide-react";

import {
	LOCAL_MODEL_SERVER_CONTRIBUTION,
	LOCAL_MODEL_SERVER_SETTINGS_SECTION,
	MODEL_LOADING_STATUS_ITEM,
	ModelServer,
} from "../contracts/index";
import { LocalModelLoadingToast } from "./LocalModelLoadingToast";
import { localModelSource } from "./model-source";
import { LocalModelServerSettings } from "./settings/LocalModelServerSettings";

export { LocalModelServerSettings } from "./settings/LocalModelServerSettings";

/**
 * kilo.local-inference's renderer entry: the Local Model Server settings
 * section, the server in the composer's model picker and before prompts
 * (`kilo.chat/model-source`), and the model-loading toast (a status bar view
 * that renders nothing, mounted in every window). Opening the section for
 * the agent happens in main, through kilo.shell's navigation.
 */
export const localInferenceWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(SettingsSection, LOCAL_MODEL_SERVER_SETTINGS_SECTION, {
			component: LocalModelServerSettings,
			icon: ServerIcon,
		});
		sdk.extensions.implement(
			ModelSource,
			LOCAL_MODEL_SERVER_CONTRIBUTION,
			localModelSource(() => sdk.domainObjects.get(ModelServer)),
		);
		sdk.extensions.implement(StatusBarItem, MODEL_LOADING_STATUS_ITEM, {
			kind: "view",
			Component: LocalModelLoadingToast,
		});
	},
});
