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
	SdkTheme,
	SdkShell,
	SdkFs,
	SdkTools,
	SdkIntents,
	ContributionOptions,
	Contribution,
	CommandDefinition,
	Command,
	NavigateIntent,
	DispatchIntent,
	MainSdk,
	FeatureRegistration,
} from "./types/sdk.js";

// Services — used by the shell to wire things up
export { EventBus } from "./services/event-bus.js";
export { StateBroker } from "./services/state-broker.js";
export { CapabilityRegistry } from "./services/capability-registry.js";
export { ContributionRegistry } from "./services/contribution-registry.js";
export { CommandRegistry } from "./services/command-registry.js";
export { FeatureRouter } from "./services/feature-router.js";
export { createSdk, type SdkFactoryServices, type ShellDelegates } from "./services/create-sdk.js";
