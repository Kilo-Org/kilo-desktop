import { readWorkSessionIdFromMetadata } from "../../../contracts";
import type { ChatRecords } from "./activity";

export interface ForkHold {
	/** The fork's id is known: hold only it from now on. */
	narrow(id: string): void;
	release(): void;
}

interface Hold {
	readonly workSessionId: string | null;
	readonly known: ReadonlySet<string>;
	id?: string;
}

/**
 * Keeps forks out of the published chats until their permission rules are
 * applied, so no window, work session or `created` listener sees a fork
 * without the desktop's rules.
 *
 * The server announces a fork's `session.created` before the fork request
 * returns, so at first a hold can't name its fork: it holds every root chat
 * first seen after it began whose stamp carries the source's work session
 * (another chat created there meanwhile only shows up a moment late). Once
 * the fork's id is known the hold narrows to it. Held roots are left out of
 * what `publishChats` reads, which drops their descendants (the fork's
 * re-forked subagent chats) with them.
 *
 * Holds live only as long as the `fork` call; what outlives it (a fork whose
 * rules never landed) is `UnfinishedForks`', which skips forks still held.
 */
export class ForkHolds {
	readonly #holds = new Set<Hold>();

	begin(workSessionId: string | null, known: Iterable<string>): ForkHold {
		const hold: Hold = { workSessionId, known: new Set(known) };
		this.#holds.add(hold);
		return {
			narrow: (id) => {
				hold.id = id;
			},
			release: () => {
				this.#holds.delete(hold);
			},
		};
	}

	/** A fork in progress has this id: its own `fork` call decides what becomes of it. */
	names(id: string): boolean {
		for (const hold of this.#holds) if (hold.id === id) return true;
		return false;
	}

	/** `chats` without the held roots. */
	visible(chats: ChatRecords): ChatRecords {
		if (this.#holds.size === 0) return chats;
		return Object.fromEntries(
			Object.entries(chats).filter(([id, record]) => !this.#held(id, record)),
		);
	}

	#held(id: string, record: ChatRecords[string]): boolean {
		for (const hold of this.#holds) {
			if (hold.id !== undefined ? hold.id === id : this.#matchesUnnamed(hold, id, record))
				return true;
		}
		return false;
	}

	#matchesUnnamed(hold: Hold, id: string, record: ChatRecords[string]): boolean {
		const info = record.info;
		return (
			!hold.known.has(id) &&
			info !== undefined &&
			info.parentId === null &&
			(readWorkSessionIdFromMetadata(info.metadata) ?? null) === hold.workSessionId
		);
	}
}
