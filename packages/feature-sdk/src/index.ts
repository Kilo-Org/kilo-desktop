// Types — the stable contract features program against
export type {
	SDK,
	SdkEvents,
	SdkState,
	StoreHandle,
	ReadableStore,
	SdkPlugins,
	SdkCommands,
	SdkNotifications,
	NotificationResult,
	SdkTheme,
	SdkShell,
	SdkFs,
	SdkTools,
	SdkIntents,
	SchemaLike,
	ContributionOptions,
	Contribution,
	CommandDefinition,
	Command,
	NavigateIntent,
	DispatchIntent,
	ChannelHandlers,
	MainSdk,
	FeatureRegistration,
} from "./types/sdk.js";

// Channel maps — typed sdk.invoke / mainSdk.channels against per-feature contracts
export {
	defineMethod,
	withChannels,
	type MethodContract,
	type ChannelMap,
	type ChannelInput,
	type ChannelHandlerInput,
	type ChannelHandlerOutput,
	type ChannelOutput,
	type InvokeArguments,
	type TypedSDK,
} from "./channel-map.js";

// Errors — thrown by feature handlers for expected failures
export { FeatureError, type FeatureErrorCode } from "./errors.js";

// Services — used by the shell to wire things up
export { EventBus } from "./services/event-bus.js";
export { StateBroker } from "./services/state-broker.js";
export { CapabilityRegistry } from "./services/capability-registry.js";
export { ContributionRegistry } from "./services/contribution-registry.js";
export { CommandRegistry } from "./services/command-registry.js";
export {
	FeatureRouter,
	type FeatureRouterOptions,
	type InvokeFallback,
} from "./services/feature-router.js";
export {
	createSdk,
	teardownFeature,
	type SdkFactoryServices,
	type ShellDelegates,
} from "./services/create-sdk.js";
