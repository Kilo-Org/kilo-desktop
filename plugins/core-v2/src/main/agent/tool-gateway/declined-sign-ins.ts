/**
 * The plugins whose sign-in tools (`requiresSignIn`) the person chose to go
 * without, from the chat's sign-in card ("Not now"), as origin's tool gateway
 * kept them.
 *
 * Ownership and invariants:
 * - One instance per gateway, shared by the Kilo and external views, so every
 *   agent sees the same tools. It lives in main, which serves every agent and
 *   window; windows read it on `kilo.core/chats` (`declinedSignInTools`) and change it
 *   through `Chats.declineSignInTools`.
 * - A scope is the id of the plugin contributing the refused tool: declining
 *   withdraws only that plugin's sign-in tools, other plugins' keep asking.
 * - Declines are only taken while signed out and are all cleared on sign-in,
 *   so a declined scope always means "signed out and said no". They are kept
 *   in memory only: they last until sign-in or the app restarts.
 * - Listeners hear only real changes, each one a `tools/list_changed`.
 */
export class DeclinedSignIns {
	readonly #listeners = new Set<() => void>();
	#scopes: readonly string[] = [];

	get scopes(): readonly string[] {
		return this.#scopes;
	}

	has(scope: string): boolean {
		return this.#scopes.includes(scope);
	}

	decline(scope: string): void {
		if (this.has(scope)) return;
		this.#set([...this.#scopes, scope]);
	}

	clear(): void {
		if (this.#scopes.length > 0) this.#set([]);
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#set(scopes: readonly string[]): void {
		this.#scopes = scopes;
		for (const listener of [...this.#listeners]) listener();
	}
}
