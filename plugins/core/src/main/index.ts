import { productionAccountOptions } from "./account/production";
import { productionAgentOptions } from "./agent/production";
import { createCoreMainEntry } from "./entry";
import { productionFlagsOptions } from "./flags/production";
import { productionModelsOptions } from "./models/production";
import { productionTelemetryOptions } from "./telemetry/production";
import { productionWorkStyleOptions } from "./work-style/production";

export { createCoreMainEntry, type CoreMainOptions } from "./entry";

/** kilo.core's main-process entry, wired to the real Kilo CLI, LaunchDarkly and PostHog. */
export const coreMainEntry = createCoreMainEntry({
	account: productionAccountOptions,
	agent: productionAgentOptions,
	models: productionModelsOptions,
	workStyle: productionWorkStyleOptions,
	flags: productionFlagsOptions,
	telemetry: productionTelemetryOptions,
});
