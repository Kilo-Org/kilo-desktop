// Main-process entry — exported from "@anaconda-agentic-desktop/feature-sdk/main"
export type { MainSdk, ChannelHandlers, FeatureRegistration, SchemaLike } from "./types/sdk.js";
export {
	defineMethod,
	type MethodContract,
	type ChannelMap,
	type ChannelInput,
	type ChannelHandlerInput,
	type ChannelHandlerOutput,
	type ChannelOutput,
} from "./channel-map.js";
export { FeatureError, type FeatureErrorCode } from "./errors.js";
export { FeatureRouter } from "./services/feature-router.js";
