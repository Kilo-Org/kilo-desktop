// Types — the stable contract features program against
export type {
	SdkClient,
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
	SdkAuth,
	AuthUser,
	AuthSession,
	SdkFeatureFlags,
	FeatureFlagMap,
	SdkShell,
	SdkFs,
	ShellFsDelegate,
	SdkTools,
	ToolDefinition,
	ToolAnnotations,
	RegisteredTool,
	SdkIntents,
	SchemaLike,
	KvStore,
	KvStoreOptions,
	KvStoreFactory,
	MainSdkStorage,
	ContributionOptions,
	Contribution,
	CommandDefinition,
	Command,
	ShellLocation,
	NavigateOptions,
	SdkLocation,
	SdkNavigation,
	PluginPageProps,
	DispatchIntent,
	ChannelHandlers,
	MainSdk,
	MainSdkBoot,
	MainSdkFetch,
	MainSdkLogger,
	MainSdkNet,
	FeatureRegistration,
} from "./types/sdk.js";

// Canonical shell zone ids (Decision #21)
export {
	SHELL_ZONES,
	SIDEBAR_ZONE,
	STATUS_BAR_ZONE,
	DASHBOARD_ZONE,
	HOME_COMPOSER_LEADING_ACTION_ZONE,
	isShellZone,
	type ShellZone,
} from "./types/zones.js";

// Channel maps — typed sdk.invoke / mainSdk.channels against per-feature contracts
export {
	defineMethod,
	defineContract,
	type InferContract,
	type MethodContract,
	type ChannelMap,
	type ChannelInput,
	type ChannelHandlerInput,
	type ChannelHandlerOutput,
	type ChannelHandler,
	type ChannelHandlerMap,
	type ChannelOutput,
	type InvokeArguments,
} from "./channel-map.js";

// Errors — thrown by feature handlers for expected failures
export { FeatureError, type FeatureErrorCode } from "./errors.js";

// Services — used by the shell to wire things up
export {
	EventBus,
	assertStructuredCloneable,
	emitFeatureEvent,
	qualifyFeatureEvent,
	type FeatureEvent,
} from "./services/event-bus.js";
export { StateBroker } from "./services/state-broker.js";
export {
	createObservableValue,
	type ObservableValue,
	type ObservableValueOptions,
} from "./services/observable-value.js";
export { CapabilityRegistry } from "./services/capability-registry.js";
export { ContributionRegistry } from "./services/contribution-registry.js";
export { CommandRegistry } from "./services/command-registry.js";
export { ToolRegistry } from "./services/tool-registry.js";
export {
	FeatureRouter,
	type CreateMainSdkOptions,
	type FeatureRouterOptions,
	type InvokeFallback,
} from "./services/feature-router.js";
export {
	createSdk,
	teardownFeature,
	type SdkFactoryServices,
	type ShellDelegates,
} from "./services/create-sdk.js";
export { createStaticNavigation } from "./services/navigation.js";

// Plugin system — manifest schema + loader (discover phase; activation stays
// with the shell boot sequences)
export {
	PLUGIN_MANIFEST_FILENAME,
	featureIdPattern,
	pluginManifestSchema,
	pluginRouteSchema,
	pluginNavEntrySchema,
	pluginZoneContributionSchema,
	pluginProviderContributionSchema,
	pluginContributesSchema,
	parsePluginManifest,
	type PluginManifest,
	type PluginRoute,
	type PluginNavEntry,
	type PluginZoneContribution,
	type PluginProviderContribution,
	type PluginContributes,
} from "./plugin/manifest.js";
export {
	discoverPlugins,
	pluginRegistrations,
	pluginRoutes,
	pluginNav,
	pluginZoneContributions,
	pluginProviderContributions,
	reportPluginDiscoveryIssues,
	PLUGIN_ROUTE_NAMESPACE,
	stripPluginNamespace,
	type BundledPlugin,
	type DiscoverPluginsOptions,
	type PluginModule,
	type PluginEntryKind,
	type DiscoveredPlugin,
	type PluginDiscovery,
	type PluginDiscoveryIssue,
	type ResolvedPluginRoute,
	type ResolvedPluginNav,
	type ResolvedPluginZoneContribution,
	type ResolvedPluginProviderContribution,
} from "./plugin/loader.js";
