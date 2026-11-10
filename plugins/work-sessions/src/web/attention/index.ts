import type { PluginSdk } from "@kilo-desktop/kernel";

import { followLastVisits, loadLastVisits } from "./last-visited";
import { trackVisits } from "./visits";

/**
 * The attention area: when this window last showed each work session, so the
 * list marks sessions whose chats finished since as unread. The main window
 * records visits; a secondary window (a popped-out view) follows them.
 */
export function activateAttention(sdk: PluginSdk): void {
	const visits = loadLastVisits();
	if (sdk.context.get("kernel/secondaryWindow")) {
		sdk.onDispose(followLastVisits());
		return;
	}
	trackVisits(sdk, visits);
}
