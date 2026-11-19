import { create } from "zustand";

import { EMPTY_FILTER, type BoardFilter } from "./board-insights";

const SEEN_KEY = "kilo.chat/swarm-board-seen";
/** Boards remembered as seen; the oldest marks drop off past this. */
const SEEN_LIMIT = 200;

type Seen = Record<string, number>;

function loadSeen(storage: Storage | undefined): Seen {
	try {
		const parsed: unknown = JSON.parse(storage?.getItem(SEEN_KEY) ?? "{}");
		if (!parsed || typeof parsed !== "object") return {};
		return Object.fromEntries(
			Object.entries(parsed).filter(([, value]) => typeof value === "number"),
		) as Seen;
	} catch {
		return {};
	}
}

function saveSeen(storage: Storage | undefined, seen: Seen): void {
	try {
		storage?.setItem(SEEN_KEY, JSON.stringify(seen));
	} catch {
		// A full or unavailable storage only costs the "new since" marks.
	}
}

interface SwarmBoardState {
	/** Each board's filter, while the window lives. */
	readonly filters: Readonly<Record<string, BoardFilter>>;
	/** The newest post the person has seen on each board (ms), kept across restarts. */
	readonly seen: Readonly<Seen>;
	setFilter(rootChatId: string, filter: BoardFilter): void;
	markSeen(rootChatId: string, timestamp: number): void;
}

/**
 * What the person did with each Swarm Board: its filter (per window, so a
 * reopened board keeps it) and how far they read (in localStorage, so the
 * Board button can count what's new and the board can mark it).
 */
export function createSwarmBoardStore(storage: Storage | undefined = globalThis.localStorage) {
	return create<SwarmBoardState>((set, get) => ({
		filters: {},
		seen: loadSeen(storage),
		setFilter: (rootChatId, filter) => set({ filters: { ...get().filters, [rootChatId]: filter } }),
		markSeen: (rootChatId, timestamp) => {
			const seen = get().seen;
			if ((seen[rootChatId] ?? 0) >= timestamp) return;
			const next = Object.fromEntries(
				Object.entries({ ...seen, [rootChatId]: timestamp })
					.toSorted(([, a], [, b]) => b - a)
					.slice(0, SEEN_LIMIT),
			);
			saveSeen(storage, next);
			set({ seen: next });
		},
	}));
}

export const useSwarmBoardStore = createSwarmBoardStore();

export const useBoardFilter = (rootChatId: string) =>
	useSwarmBoardStore((state) => state.filters[rootChatId] ?? EMPTY_FILTER);
