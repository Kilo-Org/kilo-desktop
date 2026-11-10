import { definePlugin, type PluginEntry, type PluginSdk } from "@kilo-desktop/kernel";

import { activateAccount, type AccountOptions } from "./account";
import { activateAgent, type AgentOptions } from "./agent";
import { activateFlags, type FlagsOptions } from "./flags";
import { activateModels, type ModelsOptions } from "./models/models";
import { activateTelemetry, type TelemetryOptions } from "./telemetry";
import { activateWorkStyle, type WorkStyleOptions } from "./work-style";

/** Each area's dependencies, built per activation (real ones in production, fakes in tests). */
export interface CoreMainOptions {
	readonly account: (sdk: PluginSdk) => AccountOptions;
	readonly agent: (sdk: PluginSdk) => AgentOptions;
	readonly models: (sdk: PluginSdk) => ModelsOptions;
	readonly workStyle: (sdk: PluginSdk) => WorkStyleOptions;
	readonly flags: (sdk: PluginSdk) => FlagsOptions;
	readonly telemetry: (sdk: PluginSdk) => TelemetryOptions;
}

/**
 * kilo.core in main, composed from independent areas that meet only through
 * kilo.core's own domain objects. The order matters only at activation: the
 * account follows `kilo.core/server` as it appears; the agent adopts its
 * predecessor's folder and provides the server before the models and
 * work-style areas use it; flags and telemetry plug into the kernel last.
 */
export function createCoreMainEntry(options: CoreMainOptions): PluginEntry {
	return definePlugin({
		async activate(sdk) {
			activateAccount(sdk, options.account(sdk));
			await activateAgent(sdk, options.agent(sdk));
			await activateModels(sdk, options.models(sdk));
			activateWorkStyle(sdk, options.workStyle(sdk));
			activateFlags(sdk, options.flags(sdk));
			activateTelemetry(sdk, options.telemetry(sdk));
		},
	});
}
