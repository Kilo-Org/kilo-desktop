import type { PluginSdk } from "@kilo-desktop/kernel";

import { Chats } from "@kilo-desktop/plugin-core/contracts";

import { startHeldPermissions } from "./held-permissions";
import { followLastVisits, loadLastVisits } from "./last-visited";
import { watchDomain } from "./live-activity";
import { trackVisits } from "./visits";

/**
 * The attention area: when this window last showed each work session, so the
 * list marks sessions whose chats finished since as unread. The main window
 * records visits; a secondary window (a popped-out view) follows them. Every
 * window holds back the permission requests a plugin answers for the person.
 */
export function activateAttention(sdk: PluginSdk): void {
	const held = startHeldPermissions(sdk);
	watchDomain(sdk, Chats, () => held.sync(sdk.domainObjects.get(Chats)?.getState().chats ?? {}));
	const visits = loadLastVisits();
	if (sdk.context.get("kernel/secondaryWindow")) {
		sdk.onDispose(followLastVisits());
		return;
	}
	trackVisits(sdk, visits);
}
