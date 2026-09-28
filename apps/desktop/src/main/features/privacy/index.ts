import { privacyChannels, type PreferencesMainCapability } from "@kilo-desktop/contracts";
import { FeatureError, type MainSdk } from "@kilo-desktop/feature-sdk/main";

const onOff = (allow: boolean) => (allow ? "on" : "off");

export function mainRegister(sdk: MainSdk): void {
	const { logger } = sdk;
	let subscribed: PreferencesMainCapability["preferences"] | undefined;
	let unsubscribe: (() => void) | undefined;
	function preferences() {
		const service = sdk.plugins.get<PreferencesMainCapability>("preferences")?.preferences;
		if (!service)
			throw new FeatureError("Privacy settings are unavailable. Restart the app and retry.");
		if (subscribed !== service) {
			unsubscribe?.();
			subscribed = service;
			unsubscribe = service.onDidChangeAllowDataCollection((allowDataCollection) => {
				sdk.events.emit("changed", { allowDataCollection });
			});
		}
		return service;
	}
	if (sdk.plugins.get<PreferencesMainCapability>("preferences")) preferences();
	sdk.channels(privacyChannels).handleAll({
		get: () => ({ allowDataCollection: preferences().allowDataCollection }),
		set: async ({ allowDataCollection }) => {
			const service = preferences();
			try {
				await service.setAllowDataCollection(allowDataCollection);
			} catch (cause) {
				logger.warn(
					`Data collection change to ${onOff(allowDataCollection)} failed; now ${onOff(service.allowDataCollection)}`,
					cause,
				);
				throw new FeatureError(
					cause instanceof Error
						? cause.message
						: "Could not update privacy settings. Retry the change.",
				);
			}
			logger.info(`Data collection turned ${onOff(service.allowDataCollection)}`);
			return { allowDataCollection: service.allowDataCollection };
		},
	});
	sdk.onDispose(() => unsubscribe?.());
}
