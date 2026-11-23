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

/**
 * Something a surface outside the board asked it to show when it next renders:
 * an agent's posts (opening the agent from the board filters to it), a
 * question waiting on the person, or a post by id.
 */
export type BoardFocus =
	| { readonly kind: "agent"; readonly chatId: string }
	| { readonly kind: "question"; readonly chatId: string }
	| { readonly kind: "post"; readonly messageId: string };

interface SwarmBoardState {
	/** Each board's filter, while the window lives. */
	readonly filters: Readonly<Record<string, BoardFilter>>;
	/** The newest post the person has seen on each board (ms), kept across restarts. */
	readonly seen: Readonly<Seen>;
	/** Per board, what it should show next; the board clears it once shown. */
	readonly focus: Readonly<Record<string, BoardFocus>>;
	setFilter(rootChatId: string, filter: BoardFilter): void;
	markSeen(rootChatId: string, timestamp: number): void;
	requestFocus(rootChatId: string, focus: BoardFocus): void;
	clearFocus(rootChatId: string): void;
}

/**
 * What the person did with each Swarm Board: its filter (per window, so a
 * reopened board keeps it), how far they read (in localStorage, so the
 * composer's shelf can count what's new and the board can mark it), and what
 * another surface asked it to show (the shelf's Answer, say).
 */
export function createSwarmBoardStore(storage: Storage | undefined = globalThis.localStorage) {
	return create<SwarmBoardState>((set, get) => ({
		filters: {},
		focus: {},
		seen: loadSeen(storage),
		setFilter: (rootChatId, filter) => set({ filters: { ...get().filters, [rootChatId]: filter } }),
		requestFocus: (rootChatId, focus) => set({ focus: { ...get().focus, [rootChatId]: focus } }),
		clearFocus: (rootChatId) => {
			if (!(rootChatId in get().focus)) return;
			const { [rootChatId]: _cleared, ...rest } = get().focus;
			set({ focus: rest });
		},
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
