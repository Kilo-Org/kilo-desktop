import { readWorkSessionIdFromMetadata } from "../../../contracts";
import type { ChatInfo } from "./activity";
import type { ForkHold, ForkHolds } from "./fork-holds";
import type { KiloChatClient } from "./kilo-chat-client";
import type { UnfinishedForks } from "./unfinished-forks";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** What a failed fork request's fork would look like, if the server made it. */
export interface LostForkSearch {
	readonly directory: string;
	readonly workSessionId: string | null;
	/** The title the server gives a fork of the source (`forkedTitle`). */
	readonly title: string;
	/** The chats known when the fork began; none of them is the fork. */
	readonly known: ReadonlySet<string>;
	/** The fork's unnamed hold, released once the search settles. */
	readonly hold: ForkHold;
}

export interface LostForksDeps {
	readonly holds: ForkHolds;
	readonly unfinished: UnfinishedForks;
	/** Deletes an unfinished fork while it is hidden; one that can't be deleted stays unfinished. */
	discard(client: KiloChatClient, directory: string, id: string): Promise<void>;
	/** Republishes the chats after a hold is released. */
	republish(): void;
	warn(message: string): void;
}

/**
 * Forks whose fork request failed though the server may have made them (the
 * reply was lost). Such a fork has no id, so only its request's unnamed
 * hold keeps it out of the published chats; releasing that hold would
 * publish a fork without the source's permission rules.
 *
 * A search settles on a read of the server's chats, or on the chats already
 * seen when they show the fork. Until one does, the search stays waiting
 * and keeps its hold, which also hides other new root chats in that work
 * session (the price of not knowing the fork's id); the caller retries the
 * read and settles waiting searches after each hydrate. Settling picks at
 * most one chat: the earliest new root chat in the source's directory with
 * its stamp and forked title whose id no fork call learned
 * (`ForkHolds.named`) and that isn't already unfinished. It is recorded as unfinished and discarded
 * like any fork left without rules. The server names forks only by their
 * source, so another client's concurrent fork of the same chat can still be
 * mistaken for this one when this one was never made; the earliest match is
 * the likeliest to be this request's.
 *
 * Searches live in memory: a quit or crash before one settles leaves a
 * made fork unfound, published on the next run.
 */
export class LostForks {
	readonly #deps: LostForksDeps;
	readonly #waiting = new Set<LostForkSearch>();

	constructor(deps: LostForksDeps) {
		this.#deps = deps;
	}

	get waiting(): boolean {
		return this.#waiting.size > 0;
	}

	/**
	 * Looks for a failed request's fork, in the server's list or else among
	 * `seen`. Resolves whether the search is still waiting, its hold kept.
	 */
	async look(
		client: KiloChatClient,
		search: LostForkSearch,
		seen: () => Iterable<ChatInfo>,
	): Promise<boolean> {
		let chats: Iterable<ChatInfo>;
		try {
			chats = await client.listChats();
		} catch (error) {
			this.#deps.warn(`Could not look for a fork whose request failed: ${errorText(error)}`);
			chats = seen();
			if (!this.#find(chats, search)) {
				this.#waiting.add(search);
				return true;
			}
		}
		await this.#settleAll(client, [search], chats);
		return false;
	}

	/** Settles every waiting search against a complete read of the server's chats. */
	settle(client: KiloChatClient, chats: Iterable<ChatInfo>): Promise<void> {
		const searches = [...this.#waiting];
		this.#waiting.clear();
		return this.#settleAll(client, searches, chats);
	}

	async #settleAll(
		client: KiloChatClient,
		searches: readonly LostForkSearch[],
		chats: Iterable<ChatInfo>,
	): Promise<void> {
		const listed = [...chats];
		const discards: Promise<void>[] = [];
		// Claims are synchronous, so each search sees the forks the ones before it claimed.
		for (const search of searches) {
			const fork = this.#find(listed, search);
			if (fork) {
				try {
					this.#deps.unfinished.add({ id: fork.id, directory: search.directory });
				} catch (error) {
					// Still remembered (so hidden) for this run.
					this.#deps.warn(`Could not record the unfinished fork ${fork.id}: ${errorText(error)}`);
				}
				discards.push(this.#deps.discard(client, search.directory, fork.id));
			}
			search.hold.release();
		}
		if (searches.length > 0) this.#deps.republish();
		await Promise.all(discards);
	}

	#find(chats: Iterable<ChatInfo>, search: LostForkSearch): ChatInfo | undefined {
		let earliest: ChatInfo | undefined;
		for (const info of chats) {
			if (!this.#matches(info, search)) continue;
			if (!earliest || info.createdAt < earliest.createdAt) earliest = info;
		}
		return earliest;
	}

	#matches(info: ChatInfo, search: LostForkSearch): boolean {
		return (
			!search.known.has(info.id) &&
			!this.#deps.holds.named(info.id) &&
			!this.#deps.unfinished.has(info.id) &&
			info.parentId === null &&
			info.directory === search.directory &&
			info.title === search.title &&
			(readWorkSessionIdFromMetadata(info.metadata) ?? null) === search.workSessionId
		);
	}
}
