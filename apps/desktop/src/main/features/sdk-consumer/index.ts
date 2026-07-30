import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";
import { sdkConsumerContract } from "@anaconda-agentic-desktop/contracts";

/**
 * The sdk-consumer feature mostly exercises cross-feature communication from
 * the renderer. This mainRegister provides a trivial ping handler so the
 * FeatureRegistration interface is satisfied and channels() is demonstrated.
 */
export function mainRegister(mainSdk: MainSdk): void {
	mainSdk.channels(sdkConsumerContract).handleAll({
		ping: () => ({ pong: true as const, from: "sdk-consumer" }),
	});
}
