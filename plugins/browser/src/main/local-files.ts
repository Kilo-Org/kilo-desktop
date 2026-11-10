import type { PluginSdk } from "@kilo-desktop/kernel";
import { Workspaces } from "@kilo-desktop/plugin-work-sessions/contracts";

import type { LocalFileAuthorizer } from "./browser-host.js";

/**
 * Which local files a Browser pane may show: those inside a registered
 * workspace folder (its managed worktrees live inside it too), origin's rule
 * (`inside`). The host hands over paths already canonical. Fails closed
 * without kilo.work-sessions' workspaces, or when they can't answer.
 */
export function createLocalFileAuthorizer(sdk: PluginSdk): LocalFileAuthorizer {
	return async (canonicalPath) => {
		const workspaces = sdk.domainObjects.get(Workspaces);
		if (!workspaces) return false;
		try {
			const { allowed } = await workspaces.methods.authorize({
				path: canonicalPath,
				rule: "inside",
			});
			return allowed;
		} catch {
			return false;
		}
	};
}
