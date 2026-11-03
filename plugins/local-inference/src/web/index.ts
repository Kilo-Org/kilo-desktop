import { definePlugin } from "@kilo-desktop/kernel";
import { ModelSource } from "@kilo-desktop/plugin-chat/contracts";
import { Navigation, Overlay, SettingsSection } from "@kilo-desktop/plugin-shell/contracts";
import { ServerIcon } from "lucide-react";

import { LOCAL_MODEL_SERVER_SETTINGS_SECTION, LocalInference } from "../contracts/index.js";
import { LocalModelLoadingToast } from "./LocalModelLoadingToast.js";
import { localModelSource } from "./model-source.js";
import { LocalModelServerSettings } from "./settings/LocalModelServerSettings.js";

export { LocalModelServerSettings } from "./settings/LocalModelServerSettings.js";

/**
 * kilo.local-inference's renderer entry: the Local Model Server settings
 * section, the server in the composer's model picker and before prompts
 * (`kilo.chat/model-source`), the model-loading toast, and opening the
 * section when the agent asks (main window only).
 */
export const localInferenceWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(SettingsSection, LOCAL_MODEL_SERVER_SETTINGS_SECTION, {
			component: LocalModelServerSettings,
			icon: ServerIcon,
		});
		sdk.extensions.implement(
			ModelSource,
			"local-model-server",
			localModelSource(() => sdk.domains.get(LocalInference)),
		);
		sdk.extensions.implement(Overlay, "model-loading", LocalModelLoadingToast);

		let stopFollowing: (() => void) | undefined;
		sdk.onDispose(
			sdk.domains.track(LocalInference, {
				added: (domain) => {
					stopFollowing = domain.on("settings-requested", () => {
						if (sdk.context.get("kernel/secondaryWindow")) return;
						void sdk.domains
							.get(Navigation)
							?.methods.openSettings({ section: LOCAL_MODEL_SERVER_SETTINGS_SECTION })
							.catch(() => undefined);
					});
				},
				removed: () => stopFollowing?.(),
			}),
		);
		sdk.onDispose(() => stopFollowing?.());
	},
});
