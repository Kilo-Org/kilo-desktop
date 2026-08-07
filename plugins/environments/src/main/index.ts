import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { ProviderRegistry } from "./ProviderRegistry.js";

/**
 * Main-process registration for the `environments` plugin.
 *
 * v1 scaffold (sub-issue 1): instantiate the {@link ProviderRegistry} and
 * leave it empty. Later slices add the conda provider inside
 * `src/main/providers/conda/` and call `registry.register(new CondaProvider())`
 * here; adding a future provider (uv, pip, …) is one line + one subdirectory.
 *
 * Cross-cutting infrastructure (JobQueue, read cache, event bus) also
 * hangs off `mainRegister` in later slices — see sub-issues 5 – 9 of the
 * delivery plan.
 */
export function mainRegister(mainSdk: MainSdk): void {
	const registry = new ProviderRegistry();

	// No providers registered in this slice — the renderer's provider tab
	// strip renders an "unavailable" empty state until sub-issue 4 wires the
	// conda provider in.
	mainSdk.logger.info(`boot: ${registry.list().length} provider(s) registered`);
}
