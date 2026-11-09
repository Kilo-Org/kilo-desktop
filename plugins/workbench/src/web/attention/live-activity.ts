import { useMemo } from "react";

import type { AnyDomain, DomainHandle, PluginSdk } from "@kilo-desktop/kernel";
import { useDomainState } from "@kilo-desktop/kernel/web";
import { Conversations } from "@kilo-desktop/plugin-agent/contracts";
import { WorkSessions, type WorkSession } from "@kilo-desktop/plugin-sessions/contracts";

import { needsAttention, type SessionActivity } from "../list/session-activity";
import { sessionActivities, type Chats } from "./session-chats";

const NO_CHATS: Chats = {};
const selectChats = (state: { chats: Chats }) => state.chats;

/** The chats kilo.agent knows, or none while it is missing. */
export function useChats(): Chats {
	return useDomainState(Conversations, selectChats) ?? NO_CHATS;
}

/** Each session's live activity, combined from its chats. */
export function useSessionActivities(
	sessions: readonly WorkSession[],
): Readonly<Record<string, SessionActivity>> {
	const chats = useChats();
	return useMemo(() => sessionActivities(sessions, chats), [chats, sessions]);
}

/** The sessions needing attention, in the given order. */
export function sessionsNeedingAttention(sdk: PluginSdk, order: readonly string[]): string[] {
	const sessions = sdk.domains.get(WorkSessions)?.getState().sessions ?? [];
	const chats = sdk.domains.get(Conversations)?.getState().chats ?? NO_CHATS;
	const activities = sessionActivities(sessions, chats);
	return order.filter((id) => needsAttention(activities[id]));
}

/**
 * Calls `onChange` whenever the domain's state changes or it comes and goes,
 * for as long as the plugin is active.
 */
export function watchDomain<TDomain extends AnyDomain>(
	sdk: PluginSdk,
	domain: TDomain,
	onChange: () => void,
	onAdded?: (handle: DomainHandle<TDomain>) => () => void,
): void {
	let stop: (() => void) | undefined;
	sdk.domains.track(domain, {
		added(handle) {
			const unsubscribe = handle.subscribe(onChange);
			const detach = onAdded?.(handle);
			stop = () => {
				unsubscribe();
				detach?.();
			};
			onChange();
		},
		removed() {
			stop?.();
			stop = undefined;
			onChange();
		},
	});
	sdk.onDispose(() => stop?.());
}
