import { useSyncExternalStore } from "react";

import type { PluginSdk } from "@kilo-desktop/kernel";
import { Chats } from "@kilo-desktop/plugin-core/contracts";

import { PERMISSION_AUTO_ANSWER_TIMEOUT_MS, PermissionAutoAnswer } from "../../contracts";
import type { ChatsById } from "./session-chats";

/*
 * Which pending permission requests session status counts. A request a
 * `permission-auto-answer` contribution takes (kilo.chat's Auto approve) is
 * held out, as kilo.chat holds back its card, until it resolves or
 * `revealAfterMs` passes; otherwise every request a busy chat makes in Auto
 * would flash the session into "Needs attention". Asking a contribution needs
 * the request, read from kilo.core, so a new request is held until that
 * answer arrives (or, when nothing can be asked, not at all). Requests that
 * stop being pending are forgotten, and asked about again should they return.
 */

export interface HeldPermissionsOptions {
	/** True when a plugin answers the request for the person; may answer at once. */
	answeredForPerson: (chatId: string, permissionId: string) => boolean | Promise<boolean>;
	revealAfterMs: number;
}

export interface HeldPermissions {
	/** The pending requests a person is shown; the rest are held. */
	shown(): ReadonlySet<string>;
	/** Follows kilo.core's chats: new requests are asked about, gone ones forgotten. */
	sync(chats: ChatsById): void;
	subscribe(listener: () => void): () => void;
	dispose(): void;
}

export function createHeldPermissions(options: HeldPermissionsOptions): HeldPermissions {
	let shown: ReadonlySet<string> = new Set();
	// One entry per hold, so a late answer about a forgotten request that came back is ignored.
	const held = new Map<string, { timer?: ReturnType<typeof setTimeout> }>();
	const listeners = new Set<() => void>();
	let disposed = false;

	const setShown = (next: ReadonlySet<string>) => {
		shown = next;
		for (const listener of listeners) listener();
	};

	const show = (permissionId: string, entry: { timer?: ReturnType<typeof setTimeout> }) => {
		if (disposed || held.get(permissionId) !== entry) return;
		clearTimeout(entry.timer);
		held.delete(permissionId);
		setShown(new Set([...shown, permissionId]));
	};

	/** Holds the request unless it is known at once that no plugin answers it. */
	const holdUnlessShown = (chatId: string, permissionId: string): boolean => {
		let answer: boolean | Promise<boolean>;
		try {
			answer = options.answeredForPerson(chatId, permissionId);
		} catch {
			answer = false;
		}
		if (answer === false) return false;
		const entry: { timer?: ReturnType<typeof setTimeout> } = {};
		entry.timer = setTimeout(() => show(permissionId, entry), options.revealAfterMs);
		held.set(permissionId, entry);
		if (answer instanceof Promise) {
			answer.then(
				(answered) => {
					if (!answered) show(permissionId, entry);
				},
				() => show(permissionId, entry),
			);
		}
		return true;
	};

	return {
		shown: () => shown,
		sync(chats) {
			if (disposed) return;
			const pending = new Map<string, string>();
			for (const summary of Object.values(chats)) {
				for (const permissionId of summary.activity.pendingPermissionIds) {
					pending.set(permissionId, summary.id);
				}
			}
			for (const [permissionId, entry] of held) {
				if (pending.has(permissionId)) continue;
				clearTimeout(entry.timer);
				held.delete(permissionId);
			}
			const next = new Set([...shown].filter((permissionId) => pending.has(permissionId)));
			for (const [permissionId, chatId] of pending) {
				if (next.has(permissionId) || held.has(permissionId)) continue;
				if (!holdUnlessShown(chatId, permissionId)) next.add(permissionId);
			}
			if (next.size !== shown.size || [...next].some((id) => !shown.has(id))) setShown(next);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		dispose() {
			disposed = true;
			for (const entry of held.values()) clearTimeout(entry.timer);
			held.clear();
			listeners.clear();
		},
	};
}

/** The chats with held requests left out; `chats` itself when nothing is held. */
export function withoutHeldPermissions(chats: ChatsById, shown: ReadonlySet<string>): ChatsById {
	const isHeld = (permissionId: string) => !shown.has(permissionId);
	if (!Object.values(chats).some((summary) => summary.activity.pendingPermissionIds.some(isHeld))) {
		return chats;
	}
	return Object.fromEntries(
		Object.entries(chats).map(([id, summary]) => [
			id,
			summary.activity.pendingPermissionIds.some(isHeld)
				? {
						...summary,
						activity: {
							...summary.activity,
							pendingPermissionIds: summary.activity.pendingPermissionIds.filter(
								(permissionId) => !isHeld(permissionId),
							),
						},
					}
				: summary,
		]),
	);
}

const NOTHING_SHOWN: ReadonlySet<string> = new Set();

/** This window's held permissions, started when kilo.work-sessions activates. */
export let heldPermissions: HeldPermissions = {
	shown: () => NOTHING_SHOWN,
	sync: () => {},
	subscribe: () => () => {},
	dispose: () => {},
};

/** Asks `permission-auto-answer` contributions about kilo.core's pending requests. */
export function startHeldPermissions(sdk: PluginSdk): HeldPermissions {
	const contributions = () => sdk.extensions.list(PermissionAutoAnswer);
	heldPermissions = createHeldPermissions({
		revealAfterMs: PERMISSION_AUTO_ANSWER_TIMEOUT_MS,
		answeredForPerson: (chatId, permissionId) => {
			const handle = sdk.domainObjects.get(Chats);
			if (!handle || contributions().length === 0) return false;
			return handle.methods.permissionRequests({ id: chatId }).then((requests) => {
				const request = requests.find((candidate) => candidate.id === permissionId);
				if (!request) return true;
				return contributions().some(
					(contribution) => contribution.implementation?.(request) === true,
				);
			});
		},
	});
	sdk.onDispose(() => heldPermissions.dispose());
	return heldPermissions;
}

export function useShownPermissions(): ReadonlySet<string> {
	return useSyncExternalStore(
		(onChange) => heldPermissions.subscribe(onChange),
		() => heldPermissions.shown(),
	);
}

/** The chats with held requests left out, following both. */
export function useChatsWithoutHeld(chats: ChatsById): ChatsById {
	const shown = useShownPermissions();
	return withoutHeldPermissions(chats, shown);
}
