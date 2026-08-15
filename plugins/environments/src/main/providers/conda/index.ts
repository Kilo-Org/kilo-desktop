import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";

import type {
	EnvironmentProvider,
	ProviderBootContext,
	ProviderRegisterContext,
	ProviderWebComponents,
} from "../../EnvironmentProvider.js";

import { CondaService } from "./CondaService.js";
import { registerCondaHandlers } from "./handlers.js";
import { stageConda } from "./staging/index.js";
import { registerCondaTools } from "../../../shared/providers/conda/tools.js";

/**
 * Conda environment provider — v1 provider for the environments plugin.
 *
 * Sub-issue 2 delivered `boot()` (Miniconda staging + system detection).
 * Sub-issue 4 wires the first handler, tool, and renderer panel around a
 * `CondaService` backed by the staged conda binary. Write ops (create,
 * install, channels, jobs.cancel) land in sub-issues 6 – 9 behind the
 * same {@link CondaService} shape.
 *
 * `webComponents` stays as placeholder function references on the
 * main-side provider: the concrete renderer panels live in
 * `plugins/environments/src/web/providers/conda/` (a subtree the main
 * bundle does not import), and the plugin's `EnvironmentsPage` mounts
 * them directly. A future refactor may move `webComponents` off the
 * main-side interface entirely; for v1 the split is enforced by the
 * lack of cross-directory imports.
 *
 * State transitions:
 * - Constructed: `#service` is `undefined`; handlers registered before
 *   `boot()` completes would fail loudly.
 * - After `boot()`: `#service` is a live {@link CondaService} pointing at
 *   the resolved `condaBinPath` — bundled or system-detected.
 * - After `registerHandlers()`: `conda.envs.list` is served.
 */
export class CondaProvider implements EnvironmentProvider {
	readonly id = "conda";
	readonly displayName = "Conda";

	readonly webComponents: ProviderWebComponents = {
		EnvironmentsPanel: () => null,
		PackagesPanel: () => null,
	};

	#service: CondaService | undefined;

	async boot(ctx: ProviderBootContext): Promise<void> {
		const { condaBinPath, condaFilesRoot } = await stageConda({
			storageDir: ctx.mainSdk.storageDir,
			fetch: ctx.mainSdk.net.fetch,
			logger: ctx.logger,
			reportProgress: (msg) => ctx.boot.reportProgress(msg),
		});
		this.#service = new CondaService({
			condaBinPath,
			condaFilesRoot,
			logger: ctx.logger,
		});
	}

	registerHandlers(ctx: ProviderRegisterContext): void {
		if (!this.#service) {
			// Defensive: `mainRegister` calls `boot()` before `registerHandlers()`
			// for every provider (see `main/index.ts`), so hitting this branch
			// means a caller wired things out of order — fail loudly instead
			// of silently registering handlers with no backend.
			throw new Error("CondaProvider.registerHandlers called before boot() resolved.");
		}
		registerCondaHandlers(ctx.mainSdk, this.#service);
	}

	registerTools(sdk: SDK): void {
		registerCondaTools(sdk);
	}
}
