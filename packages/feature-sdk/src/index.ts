// Types — the stable contract features program against
export type {
	SdkClient,
	SDK,
	SdkEvents,
	SdkPorts,
	SdkState,
	StoreHandle,
	ReadableStore,
	SdkPlugins,
	SdkCommands,
	SdkNotifications,
	NotificationResult,
	SdkTelemetry,
	TelemetryData,
	SdkTheme,
	TerminalPalette,
	ThemeAppearance,
	SdkAuth,
	AuthUser,
	AuthSession,
	SdkFeatureFlags,
	FeatureFlagMap,
	SdkShell,
	PaneWindow,
	SdkFs,
	SdkWorkspace,
	WorkspaceFileChangeType,
	WorkspaceFileChange,
	WorkspaceFileChangeEvent,
	WorkspaceSubscriptionOptions,
	ShellFsDelegate,
	SdkTools,
	ToolDefinition,
	ToolSignInPrompt,
	ToolAnnotations,
	ToolInvocationContext,
	RegisteredTool,
	SdkIntents,
	SchemaLike,
	ContributionMountPolicy,
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
	MainSdkPorts,
	HostMessagePort,
	HostPortContext,
	MainSdkHost,
	MainSdkHostDialogOptions,
	MainSdkHostBrowser,
	HostBrowserController,
	HostBrowserState,
	MainSdkProtocol,
	KvStore,
	KvStoreOptions,
	KvStoreFactory,
	MainSdkStorage,
	MainSdkFetch,
	MainSdkLogger,
	MainSdkNet,
	FeatureRegistration,
} from "./types/sdk.js";

export {
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	CLIPBOARD_WRITE_EMBEDDED_PERMISSION,
	EMBEDDED_WEB_HOST_CAPABILITY,
	type EmbeddedWebHost,
	type EmbeddedWebHostPermission,
	type EmbeddedWebHostRouteContext,
	type EmbeddedWebHostSecurityProfile,
} from "./types/embedded-web-host.js";

// Keyboard shortcuts
export {
	EFFECTIVE_KEYBINDINGS_STORE,
	chordFromKeyboardEvent,
	detectKeyboardPlatform,
	formatChord,
	hasCommandModifier,
	parseChord,
	reservedChordAction,
	resolveKeybinding,
	serializeChord,
	type KeyChord,
	type KeyboardEventLike,
	type KeyboardPlatform,
	type KeybindingSpec,
} from "./keybindings.js";

// Canonical shell zone ids (Decision #21)
export {
	SHELL_ZONES,
	SIDEBAR_ZONE,
	SIDEBAR_ACCOUNT_ZONE,
	SIDEBAR_HEADER_ACTIONS_ZONE,
	STATUS_BAR_ZONE,
	DASHBOARD_ZONE,
	PAGE_HEADER_ACTIONS_ZONE,
	SETTINGS_ABOUT_SUPPORT_ZONE,
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
export { CapabilityRegistry } from "./services/capability-registry.js";
export { ContributionRegistry } from "./services/contribution-registry.js";
export { CommandRegistry } from "./services/command-registry.js";
export { ToolRegistry } from "./services/tool-registry.js";
export { agentToolName } from "./services/agent-tool-name.js";
export {
	SIGN_IN_DECLINED_TOOL_ERROR_CODE,
	SIGN_IN_DECLINED_TOOL_MESSAGE,
	SIGN_IN_REQUIRED_TOOL_ERROR_CODE,
	isSignInDeclinedToolResult,
	isSignInRequiredToolResult,
	signInRequiredToolMessage,
	type SignInRefusalAudience,
} from "./services/sign-in-required.js";
export {
	MAX_CATALOG_TOOLS,
	TOOL_CATALOG_FEATURE_ID,
	TOOL_CATALOG_PORT_CHANNEL,
	TOOL_CATALOG_PROTOCOL_VERSION,
	TOOL_NAME_PATTERN,
	toolCallContextSchema,
	toolCatalogConsumerMessageSchema,
	toolCatalogPortArgsSchema,
	toolCatalogProducerMessageSchema,
	toolDescriptorSchema,
	type ToolCatalogConsumerMessage,
	type ToolCatalogProducerMessage,
	type ToolDescriptor,
} from "./services/tool-catalog-protocol.js";
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
export {
	createWorkspaceChangeFilter,
	createWorkspaceService,
	escapeGlob,
	toPosixPath,
	WORKSPACE_FILE_CHANGE_EVENT,
} from "./services/workspace.js";
export { createStaticNavigation } from "./services/navigation.js";
export {
	createObservableValue,
	type ObservableValue,
	type ObservableValueOptions,
} from "./services/observable-value.js";

// Plugin system — manifest schema + loader (discover phase; activation stays
// with the shell boot sequences)
export {
	PLUGIN_MANIFEST_FILENAME,
	featureIdPattern,
	pluginManifestSchema,
	pluginPageSurfaceSchema,
	pluginRouteHeaderSchema,
	contributionMountPolicySchema,
	pluginRouteSchema,
	pluginNavEntrySchema,
	pluginZoneContributionSchema,
	pluginZoneDeclarationSchema,
	pluginProviderContributionSchema,
	pluginSettingsContributionSchema,
	pluginDeepLinkSchema,
	pluginContributesSchema,
	parsePluginManifest,
	type PluginManifest,
	type PluginPageSurface,
	type PluginRouteHeader,
	type PluginRoute,
	type PluginNavEntry,
	type PluginZoneContribution,
	type PluginZoneDeclaration,
	type PluginProviderContribution,
	type PluginSettingsContribution,
	type PluginDeepLink,
	type PluginContributes,
} from "./plugin/manifest.js";
export {
	discoverPlugins,
	pluginRegistrations,
	pluginRoutes,
	pluginNav,
	pluginZoneContributions,
	pluginProviderContributions,
	pluginSettingsContributions,
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
	type ResolvedPluginSettingsContribution,
} from "./plugin/loader.js";
