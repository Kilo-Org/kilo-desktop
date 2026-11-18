import type { AnyDomainObject, DomainObjectHandle, PluginSdk } from "@kilo-desktop/kernel";
import { useDomainObjectState } from "@kilo-desktop/kernel/web";
import { Chats } from "@kilo-desktop/plugin-core/contracts";
import { WorkSessions, type WorkSession } from "../../contracts";
import { needsAttention, type SessionActivity } from "../list/session-activity";
import { heldPermissions, useChatsWithoutHeld, withoutHeldPermissions } from "./held-permissions";
import { sessionActivities, type ChatsById } from "./session-chats";

const NO_CHATS: ChatsById = {};
const selectChats = (state: { chats: ChatsById }) => state.chats;

/**
 * The chats kilo.core knows, or none while it is missing, without the
 * permission requests a plugin answers for the person (see `held-permissions`).
 */
export function useChats(): ChatsById {
	return useChatsWithoutHeld(useDomainObjectState(Chats, selectChats) ?? NO_CHATS);
}

/** Each session's live activity, combined from its chats. */
export function useSessionActivities(
	sessions: readonly WorkSession[],
): Readonly<Record<string, SessionActivity>> {
	const chats = useChats();
	return sessionActivities(sessions, chats);
}

/** The sessions needing attention, in the given order. */
export function sessionsNeedingAttention(sdk: PluginSdk, order: readonly string[]): string[] {
	const sessions = sdk.domainObjects.get(WorkSessions)?.getState().workSessions ?? [];
	const chats = withoutHeldPermissions(
		sdk.domainObjects.get(Chats)?.getState().chats ?? NO_CHATS,
		heldPermissions.shown(),
	);
	const activities = sessionActivities(sessions, chats);
	return order.filter((id) => needsAttention(activities[id]));
}

/**
 * Calls `onChange` whenever the domain's state changes or it comes and goes,
 * for as long as the plugin is active.
 */
export function watchDomain<TDomain extends AnyDomainObject>(
	sdk: PluginSdk,
	domain: TDomain,
	onChange: () => void,
	onAdded?: (handle: DomainObjectHandle<TDomain>) => () => void,
): void {
	let stop: (() => void) | undefined;
	sdk.domainObjects.track(domain, {
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
