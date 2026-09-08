import type { MainSdk } from "@anaconda-agentic-desktop/feature-sdk/main";

import { gitContract } from "../contracts/schemas.js";
import { GitService } from "./git-service.js";

/**
 * Main-process registration for the git plugin.
 *
 * Main-only by design: git needs Node and the system git binary, so there is
 * no `browserRegister` and browser mode skips the plugin. Stateless — no
 * `onDispose` needed. No feature-flag gate: core infrastructure, not a
 * flagged product feature.
 */
export function mainRegister(mainSdk: MainSdk): void {
	const service = new GitService({ logger: mainSdk.logger });

	mainSdk.channels(gitContract).handleAll({
		status: ({ workingDirectory }) => service.status(workingDirectory),
		available: () => service.available(),
	});
}
