import type { ModelProviderEntry, ModelProviderSource } from "@kilo-desktop/plugin-agent/contracts";

import type { KiloCapability } from "./inference/LocalInferenceService.js";

/**
 * The provider entry the service publishes, as kilo.agent's `model-provider`
 * source: `kilo` is what the service writes through (origin's capability
 * shape), `source` what kilo.agent reads. Environment goes through
 * `runtime-config` instead, so `serverEnv` keeps nothing.
 */
export function createKiloProvider(): {
	readonly kilo: KiloCapability;
	readonly source: ModelProviderSource;
} {
	let entry: ModelProviderEntry | undefined;
	const listeners = new Set<() => void>();
	const publish = async (next: ModelProviderEntry | undefined) => {
		entry = next;
		for (const listener of listeners) listener();
	};
	return {
		kilo: {
			kiloService: {
				serverEnv: { contribute: () => () => undefined },
				providerConfig: {
					set: (_source, _provider, next) => publish(next),
					replace: (_source, _provider, next) => publish(next),
					remove: () => publish(undefined),
				},
			},
		},
		source: {
			read: () => entry,
			subscribe: (onChange) => {
				listeners.add(onChange);
				return () => listeners.delete(onChange);
			},
		},
	};
}
