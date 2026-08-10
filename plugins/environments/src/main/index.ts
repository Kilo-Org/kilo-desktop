import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { ProviderRegistry } from "./ProviderRegistry.js";
import { CondaProvider } from "./providers/conda/index.js";

/**
 * Main-process registration for the `environments` plugin.
 *
 * Boots registered providers sequentially (staging is one-time, first-launch
 * work), then binds their handlers. Async so the shell can await staging
 * and deliver progress to the splash throughout.
 */
export async function mainRegister(mainSdk: MainSdk): Promise<void> {
	const registry = new ProviderRegistry();
	registry.register(new CondaProvider());

	for (const provider of registry.list()) {
		if (provider.boot) {
			await provider.boot({ mainSdk, boot: mainSdk.boot, logger: mainSdk.logger });
		}
	}

	// Handlers are registered AFTER all providers have booted so they never
	// serve requests against a not-yet-staged conda binary.
	for (const provider of registry.list()) {
		provider.registerHandlers({ mainSdk });
	}

	mainSdk.logger.info(`boot: ${registry.list().length} provider(s) registered`);
}
