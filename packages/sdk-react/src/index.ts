export {
	createFeatureSystem,
	SdkProvider,
	useFeatureSystem,
	useSdk,
	type CreateFeatureSystemOptions,
	type FeatureSystem,
	type FeatureSystemTransport,
} from "./SdkProvider.js";

export {
	sdkQueryKey,
	sdkQueryOptions,
	useSdkQuery,
	type SdkChannelArgs,
	type SdkChannelResult,
} from "./useSdkQuery.js";

export {
	sdkMutationOptions,
	useSdkMutation,
	type SdkMutationConfig,
	type SdkMutationVariables,
} from "./useSdkMutation.js";

export { configureDesktopFocusManager } from "./configureDesktopFocusManager.js";

export { useFeatureFlag } from "./useFeatureFlag.js";
export { useSignIn, type SignIn } from "./useSignIn.js";
export { useSignInPrompt, type SignInPrompt } from "./useSignInPrompt.js";
export { KiloAuthGate } from "./KiloAuthGate.js";
export { useWorkspaceWatcher, type UseWorkspaceWatcherOptions } from "./useWorkspaceWatcher.js";
export { useSdkContributions } from "./useSdkContributions.js";

export { useTelemetry } from "./useTelemetry.js";
export {
	SettingsPageHeader,
	SettingsSectionProvider,
	type SettingsSectionInfo,
} from "./SettingsPageHeader.js";
