import type { SavedRevealResult } from "@kilo-desktop/plugin-work-sessions/contracts";

/** Where to scroll a chat's transcript: a passage in a reply, or its latest message. */
export type RevealTarget = { readonly messageId: string; readonly anchor: string } | "latest";

export interface RevealRequest {
	readonly chatId: string;
	readonly target: RevealTarget;
	readonly resolve: (result: SavedRevealResult) => void;
}

type Listener = () => void;

/** Long enough for a chat opened cold to load its older history. */
const WAIT_MS = 10_000;

/**
 * Reveal requests in one window, from the Saved page to whichever agent
 * pane shows the chat once it mounts. A request nobody takes in a few
 * seconds resolves as unavailable.
 */
export class RevealRequests {
	#pending: RevealRequest | null = null;
	readonly #listeners = new Set<Listener>();

	request(chatId: string, target: RevealTarget): Promise<SavedRevealResult> {
		this.#pending?.resolve("unavailable");
		return new Promise((resolve) => {
			// Only a request nobody has taken times out: once `take()` hands it to a
			// reveal in progress, that reveal settles it, so the deadline must not
			// resolve it as unavailable underneath the running reveal.
			const timer = setTimeout(() => {
				if (this.#pending === request) this.#settle(request, "unavailable");
			}, WAIT_MS);
			const request: RevealRequest = {
				chatId,
				target,
				resolve: (result) => {
					clearTimeout(timer);
					resolve(result);
				},
			};
			this.#pending = request;
			this.#notify();
		});
	}

	/** The pending request for a chat, if any; the taker settles it. */
	take(chatId: string | null): RevealRequest | null {
		const pending = this.#pending;
		if (!pending || !chatId || pending.chatId !== chatId) return null;
		this.#pending = null;
		return pending;
	}

	#settle(request: RevealRequest, result: SavedRevealResult): void {
		if (this.#pending === request) this.#pending = null;
		request.resolve(result);
	}

	subscribe = (listener: Listener): (() => void) => {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	};

	#notify(): void {
		for (const listener of [...this.#listeners]) listener();
	}
}
