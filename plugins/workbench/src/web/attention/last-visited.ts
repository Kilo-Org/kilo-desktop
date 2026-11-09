import { useSyncExternalStore } from "react";

import type { WorkSession } from "@kilo-desktop/plugin-sessions/contracts";

/*
 * When this window last showed each Work Session, kept in localStorage: a
 * session whose chats finished after that is unread. Origin kept visits per
 * chat; the first run carries those over (`originChats`), and a session counts
 * as visited when any of its chats was, until it is visited again here.
 */

export const LAST_VISITED_STORAGE_KEY = "kilo.workbench.last-visited:v1";
export const ORIGIN_LAST_VISITED_STORAGE_KEY = "kilo-ui:thread-last-visited:v1";

export interface LastVisited {
	readonly sessions: Readonly<Record<string, number>>;
	readonly originChats: Readonly<Record<string, number>>;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function timestamps(value: unknown): Record<string, number> {
	if (typeof value !== "object" || value === null) return {};
	return Object.fromEntries(
		Object.entries(value).filter(
			(entry): entry is [string, number] =>
				typeof entry[1] === "number" && Number.isFinite(entry[1]),
		),
	);
}

function readJson(storage: StorageLike, key: string): unknown {
	try {
		const raw = storage.getItem(key);
		return raw === null ? undefined : JSON.parse(raw);
	} catch {
		return undefined;
	}
}

function load(storage: StorageLike | null): LastVisited {
	if (!storage) return { sessions: {}, originChats: {} };
	const saved = readJson(storage, LAST_VISITED_STORAGE_KEY) as Partial<LastVisited> | undefined;
	if (saved !== undefined) {
		return { sessions: timestamps(saved?.sessions), originChats: timestamps(saved?.originChats) };
	}
	const adopted = {
		sessions: {},
		originChats: timestamps(readJson(storage, ORIGIN_LAST_VISITED_STORAGE_KEY)),
	};
	save(storage, adopted);
	return adopted;
}

function save(storage: StorageLike | null, visits: LastVisited): void {
	try {
		storage?.setItem(LAST_VISITED_STORAGE_KEY, JSON.stringify(visits));
	} catch {
		// Storage throws in private browsing or when full; visits stay in memory.
	}
}

/** When the session was last shown here; undefined when never. */
export function lastVisitedOf(
	visits: LastVisited,
	session: Pick<WorkSession, "id" | "chatIds">,
): number | undefined {
	const own = visits.sessions[session.id];
	if (own !== undefined) return own;
	const inherited = session.chatIds.flatMap((chatId) => visits.originChats[chatId] ?? []);
	return inherited.length > 0 ? Math.max(...inherited) : undefined;
}

export interface LastVisitedStore {
	snapshot(): LastVisited;
	/** Records a visit; an earlier time than the one known changes nothing. */
	mark(sessionId: string, at: number): void;
	/** Reads the saved visits again (another window recorded some). */
	reload(): void;
	subscribe(listener: () => void): () => void;
}

export function createLastVisitedStore(storage: StorageLike | null): LastVisitedStore {
	let visits = load(storage);
	const listeners = new Set<() => void>();
	return {
		snapshot: () => visits,
		reload() {
			visits = load(storage);
			for (const listener of listeners) listener();
		},
		mark(sessionId, at) {
			if ((visits.sessions[sessionId] ?? -Infinity) >= at) return;
			visits = { ...visits, sessions: { ...visits.sessions, [sessionId]: at } };
			save(storage, visits);
			for (const listener of listeners) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

function windowStorage(): StorageLike | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

/** This window's visits, loaded when kilo.workbench activates. */
export let lastVisits: LastVisitedStore = createLastVisitedStore(null);

export function loadLastVisits(): LastVisitedStore {
	lastVisits = createLastVisitedStore(windowStorage());
	return lastVisits;
}

/**
 * Follows visits the main window records, for a secondary window that shows
 * sessions without visiting them (a popped-out sessions view).
 */
export function followLastVisits(): () => void {
	const onStorage = (event: StorageEvent) => {
		if (event.key === LAST_VISITED_STORAGE_KEY) lastVisits.reload();
	};
	globalThis.addEventListener?.("storage", onStorage);
	return () => globalThis.removeEventListener?.("storage", onStorage);
}

export function useLastVisits(): LastVisited {
	return useSyncExternalStore(
		(onChange) => lastVisits.subscribe(onChange),
		() => lastVisits.snapshot(),
	);
}
