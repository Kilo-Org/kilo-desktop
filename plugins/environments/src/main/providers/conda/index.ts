import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

import type {
	EnvironmentProvider,
	ProviderBootContext,
	ProviderRegisterContext,
	ProviderWebComponents,
} from "../../EnvironmentProvider.js";

import { stageConda } from "./staging/index.js";

/**
 * Conda environment provider — v1 provider for the environments plugin.
 *
 * Sub-issue 2 delivers only the boot step (Miniconda staging). Handler
 * registration and tools are wired in sub-issues 4+.
 */
export class CondaProvider implements EnvironmentProvider {
	readonly id = "conda";
	readonly displayName = "Conda";

	readonly webComponents: ProviderWebComponents = {
		EnvironmentsPanel: () => null,
		PackagesPanel: () => null,
	};

	async boot(ctx: ProviderBootContext): Promise<void> {
		await stageConda({
			storageDir: ctx.mainSdk.storageDir,
			fetch: ctx.mainSdk.net.fetch,
			logger: ctx.logger,
			reportProgress: (msg) => ctx.boot.reportProgress(msg),
		});
	}

	registerHandlers(_ctx: ProviderRegisterContext): void {
		// Sub-issue 4 wires conda handlers.
	}

	registerTools(_sdk: SDK): void {
		// Sub-issue 4 wires conda tools.
	}
}
