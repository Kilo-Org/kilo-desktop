import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

/**
 * The sdk-consumer feature has no backend — it only exercises cross-feature
 * communication from the renderer side. This mainRegister is intentionally
 * empty (required by FeatureRegistration interface).
 */
export function mainRegister(mainSdk: MainSdk): void {
	mainSdk.handle("ping", null, () => ({ pong: true, from: "sdk-consumer" }));
}
