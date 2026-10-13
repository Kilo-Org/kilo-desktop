import type { AgentToolSignInState } from "../../contracts/schemas.js";

/**
 * Sign-in gating for agent tools that declare `requiresSignIn`.
 *
 * Ownership and invariants:
 * - One instance per tool gateway, shared by the Kilo and external views, so
 *   both agents see the same gate. It lives in main because main serves every
 *   agent and every window; renderers only read and change it through the
 *   kilo-server contract and its change event.
 * - Whether the user is signed in is asked of the auth source on every gated
 *   call. That source (`AuthSessionService.getSession()`) caches the session
 *   for the process lifetime and re-reads it only when the app refreshes it
 *   (in-app sign-in/out, gated pages mounting). So a session that ends outside
 *   the app (credential revoked, CLI sign-out) is seen only after the next
 *   refresh, the same as the gated Conda Environments page.
 * - `declined` records that the user chose not to sign in. It withdraws gated
 *   tools from agents and refuses their calls without asking again. It is in
 *   memory only and cleared when the user signs in, so it lasts until sign-in
 *   or app restart.
 * - Listeners hear only real changes to `declined`.
 */
export class AgentToolSignIn {
	readonly #isSignedIn: () => Promise<boolean>;
	readonly #listeners = new Set<() => void>();
	#state: AgentToolSignInState = { declined: false };

	constructor(isSignedIn: () => Promise<boolean>) {
		this.#isSignedIn = isSignedIn;
	}

	get state(): AgentToolSignInState {
		return this.#state;
	}

	isSignedIn(): Promise<boolean> {
		return this.#isSignedIn();
	}

	decline(): AgentToolSignInState {
		this.#setDeclined(true);
		return this.#state;
	}

	signedIn(): void {
		this.#setDeclined(false);
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#setDeclined(declined: boolean): void {
		if (this.#state.declined === declined) return;
		this.#state = { declined };
		for (const listener of [...this.#listeners]) listener();
	}
}
