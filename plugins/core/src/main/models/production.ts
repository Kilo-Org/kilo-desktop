import { mainHost, type PluginSdk } from "@kilo-desktop/kernel";

import { createKiloModelsClient } from "./kilo-models-client";
import type { ModelsOptions } from "./models";

/** Production wiring: the real Kilo SDK client and the host's network for the gateway catalog. */
export function productionModelsOptions(sdk: PluginSdk): ModelsOptions {
	const host = mainHost(sdk);
	return {
		createClient: createKiloModelsClient,
		fetch: (input, init) => host.net.fetch(input, init),
		env: process.env,
	};
}
