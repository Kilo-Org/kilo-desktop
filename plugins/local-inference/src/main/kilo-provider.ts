import type { AiProviderSource } from "@kilo-desktop/plugin-core/contracts";

import type { KiloCapability } from "./inference/LocalInferenceService";
import { LLAMA_API_KEY_ENV } from "./integrations/kilo-constants";

/**
 * The provider entry the service publishes, as kilo.core's `ai-provider`
 * source: `kilo` is what the service writes through (origin's capability
 * shape), `source` what kilo.core reads. The router's API key goes with the
 * entry as its env, so `serverEnv` keeps nothing.
 */
export function createKiloProvider(apiKey: () => string): {
	readonly kilo: KiloCapability;
	readonly source: AiProviderSource;
} {
	let entry: Readonly<Record<string, unknown>> | undefined;
	const listeners = new Set<() => void>();
	const publish = async (next: Readonly<Record<string, unknown>> | undefined) => {
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
			read: () => (entry ? { entry, env: { [LLAMA_API_KEY_ENV]: apiKey() } } : undefined),
			subscribe: (onChange) => {
				listeners.add(onChange);
				return () => listeners.delete(onChange);
			},
		},
	};
}
