// Main-process entry — exported from "@kilo-desktop/feature-sdk/main"
export {
	ACTIVE_UNTRUSTED_CONTENT_SECURITY_PROFILE,
	CLIPBOARD_WRITE_EMBEDDED_PERMISSION,
	EMBEDDED_WEB_HOST_CAPABILITY,
	EMBEDDED_WEB_HOST_SECURITY_PROFILES,
	HTML_RENDER_CONTENT_SECURITY_PROFILE,
	createBrowserLocalFileContentSecurityPolicy,
	createHtmlRenderContentSecurityPolicy,
	type EmbeddedWebHost,
	type EmbeddedWebHostPermission,
	type EmbeddedWebHostRouteContext,
	type EmbeddedWebHostSecurityProfile,
} from "./types/embedded-web-host.js";
export {
	BROWSER_LOCAL_FILE_SCHEME,
	browserLocalFilePath,
	browserLocalFileUrl,
	isBrowserLocalFileUrl,
} from "./types/browser-local-file.js";

export type {
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
	KvStore,
	KvStoreOptions,
	KvStoreFactory,
	MainSdkStorage,
	MainSdkFetch,
	MainSdkLogger,
	MainSdkNet,
	ChannelHandlers,
	FeatureRegistration,
	SchemaLike,
} from "./types/sdk.js";
export {
	defineMethod,
	type MethodContract,
	type ChannelMap,
	type ChannelInput,
	type ChannelHandlerInput,
	type ChannelHandlerOutput,
	type ChannelHandler,
	type ChannelHandlerMap,
	type ChannelOutput,
} from "./channel-map.js";
export { FeatureError, type FeatureErrorCode } from "./errors.js";
export { FeatureRouter, type CreateMainSdkOptions } from "./services/feature-router.js";
export { EventBus, type FeatureEvent } from "./services/event-bus.js";
export { CapabilityRegistry } from "./services/capability-registry.js";
export {
	createObservableValue,
	type ObservableValue,
	type ObservableValueOptions,
} from "./services/observable-value.js";
