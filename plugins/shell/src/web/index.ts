import { definePlugin } from "@kilo-desktop/kernel";

import { activateAccount } from "./account";
import { activateAiProviders } from "./ai-providers";
import { activateExternalApps } from "./external-apps";
import { activateFrame } from "./frame";
import { activateSettings } from "./settings";
import { activateSupport } from "./support";
import { activateUpdates } from "./updates";
import { activateWorkStyleStep } from "./work-style";

/**
 * kilo.shell in a window, composed from areas that meet only through
 * kilo.shell's contracts. The frame goes first: it provides `kilo.shell/theme`,
 * which every other area's UI reads.
 */
export const shellWebEntry = definePlugin({
	activate(sdk) {
		activateFrame(sdk);
		activateSettings(sdk);
		activateUpdates(sdk);
		activateAccount(sdk);
		activateAiProviders(sdk);
		activateExternalApps(sdk);
		activateWorkStyleStep(sdk);
		activateSupport(sdk);
	},
});
