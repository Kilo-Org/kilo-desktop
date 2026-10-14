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
 * - `declined` records the feature scopes the user chose not to sign in for.
 *   A declined scope withdraws that feature's gated tools from agents and
 *   refuses their calls without asking again; other features keep asking. It
 *   is in memory only and cleared when the user signs in, so it lasts until
 *   sign-in or app restart.
 * - Listeners hear only real changes to `declined`.
 */
export class AgentToolSignIn {
	readonly #isSignedIn: () => Promise<boolean>;
	readonly #listeners = new Set<() => void>();
	#state: AgentToolSignInState = { declined: [] };

	constructor(isSignedIn: () => Promise<boolean>) {
		this.#isSignedIn = isSignedIn;
	}

	get state(): AgentToolSignInState {
		return this.#state;
	}

	isSignedIn(): Promise<boolean> {
		return this.#isSignedIn();
	}

	/** Whether the user declined to sign in for this feature's tools. */
	isDeclined(scope: string | undefined): boolean {
		return scope !== undefined && this.#state.declined.includes(scope);
	}

	decline(scope: string): AgentToolSignInState {
		this.#setDeclined([...this.#state.declined, scope]);
		return this.#state;
	}

	signedIn(): void {
		this.#setDeclined([]);
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#setDeclined(declined: readonly string[]): void {
		const next = [...new Set(declined)];
		if (
			next.length === this.#state.declined.length &&
			next.every((scope, index) => scope === this.#state.declined[index])
		) {
			return;
		}
		this.#state = { declined: next };
		for (const listener of [...this.#listeners]) listener();
	}
}
