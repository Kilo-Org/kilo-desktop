import type { PluginSdk } from "@kilo-desktop/kernel";
import { Chats } from "@kilo-desktop/plugin-core/contracts";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

import { WorkSessions, WorkSessionsWindow } from "../../contracts";
import { lastVisitedOf, type LastVisitedStore } from "./last-visited";
import { sessionActivities } from "./session-chats";
import { watchDomain } from "./live-activity";

/**
 * The session this window shows: open in the navigator while the home view
 * is up and no sessions view covers it.
 */
export function visibleSessionId(sdk: PluginSdk): string | null {
	const navigator = sdk.domainObjects.get(WorkSessionsWindow)?.getState();
	const path =
		sdk.domainObjects.get(Navigation)?.getState().windows[sdk.windowId ?? "main"]?.path ?? "/";
	return path === "/" && !navigator?.view ? (navigator?.activeWorkSessionId ?? null) : null;
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
		const session = sdk.domainObjects
			.get(WorkSessions)
			?.getState()
			.workSessions.find(({ id }) => id === sessionId);
		if (!sessionId || !session) {
			shown = null;
			return;
		}
		const chats = sdk.domainObjects.get(Chats)?.getState().chats ?? {};
		const completedAt = sessionActivities([session], chats)[session.id]?.completedAt;
		if (sessionId !== shown) {
			shown = sessionId;
			visits.mark(sessionId, Math.max(Date.now(), completedAt ?? 0));
			return;
		}
		const visitedAt = lastVisitedOf(visits.snapshot(), session) ?? -Infinity;
		if (completedAt !== undefined && completedAt > visitedAt) visits.mark(sessionId, completedAt);
	};
	watchDomain(sdk, WorkSessionsWindow, check);
	watchDomain(sdk, Navigation, check);
	watchDomain(sdk, WorkSessions, check);
	watchDomain(sdk, Chats, check);
}
