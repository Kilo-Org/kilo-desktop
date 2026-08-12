// Main-process entry — exported from "@anaconda-agentic-desktop/feature-sdk/main"
export type {
	MainSdk,
	MainSdkBoot,
	MainSdkPorts,
	HostMessagePort,
	HostPortContext,
	MainSdkHost,
	MainSdkHostDialogOptions,
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
