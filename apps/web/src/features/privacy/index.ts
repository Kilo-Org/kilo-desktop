import { privacyChannels } from "@kilo-desktop/contracts";
import { FeatureError, type MainSdk } from "@kilo-desktop/feature-sdk";

export { PrivacySettings } from "./PrivacySettings.js";

/** Standalone browser mode cannot grant consent to desktop reporting. */
export function browserRegister(sdk: MainSdk): void {
	sdk.channels(privacyChannels).handleAll({
		get: () => ({ allowDataCollection: false }),
		set: () => {
			throw new FeatureError("Privacy settings are available in the desktop app.");
		},
	});
}
