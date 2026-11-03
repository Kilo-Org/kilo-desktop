import type { PluginSdk } from "@kilo-desktop/kernel";
import { Conversations } from "@kilo-desktop/plugin-agent/contracts";
import { Sessions } from "@kilo-desktop/plugin-sessions/contracts";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

import { Navigator } from "../../contracts";
import { lastVisitedOf, type LastVisitedStore } from "./last-visited";
import { sessionActivities } from "./session-chats";
import { watchDomain } from "./live-activity";

/**
 * The session this window shows: open in the navigator while the home view
 * is up and no sessions view covers it.
 */
export function visibleSessionId(sdk: PluginSdk): string | null {
	const navigator = sdk.domains.get(Navigator)?.getState();
	const path = sdk.domains.get(Navigation)?.getState().path ?? "/";
	return path === "/" && !navigator?.view ? (navigator?.activeSessionId ?? null) : null;
}

/**
 * Marks the session this window shows as visited when it comes into view,
 * and again when its chats finish while it stays in view (a finish you
 * watched is already read).
 */
export function trackVisits(sdk: PluginSdk, visits: LastVisitedStore): void {
	let shown: string | null = null;
	const check = () => {
		const sessionId = visibleSessionId(sdk);
		const session = sdk.domains
			.get(Sessions)
			?.getState()
			.sessions.find(({ id }) => id === sessionId);
		if (!sessionId || !session) {
			shown = null;
			return;
		}
		const chats = sdk.domains.get(Conversations)?.getState().chats ?? {};
		const completedAt = sessionActivities([session], chats)[session.id]?.completedAt;
		if (sessionId !== shown) {
			shown = sessionId;
			visits.mark(sessionId, Math.max(Date.now(), completedAt ?? 0));
			return;
		}
		const visitedAt = lastVisitedOf(visits.snapshot(), session) ?? -Infinity;
		if (completedAt !== undefined && completedAt > visitedAt) visits.mark(sessionId, completedAt);
	};
	watchDomain(sdk, Navigator, check);
	watchDomain(sdk, Navigation, check);
	watchDomain(sdk, Sessions, check);
	watchDomain(sdk, Conversations, check);
}
