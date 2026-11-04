import { z } from "zod";

import { isQualifiedId, ownerOf, type QualifiedId } from "./ids";

/**
 * A `when` condition: every key in `all` must be true and every key in
 * `none` must be false. Keys are qualified context keys (`acme.account/signedIn`);
 * an unknown or unset key is false.
 */
export interface WhenExpression {
	readonly all?: readonly string[] | undefined;
	readonly none?: readonly string[] | undefined;
}

const contextKeyRef = z.string().refine(isQualifiedId, "Context keys are qualified: <owner>/<key>");

export const whenSchema = z.strictObject({
	all: z.array(contextKeyRef).optional(),
	none: z.array(contextKeyRef).optional(),
});

export type ContextKeyScope = "global" | "window";

export interface ContextKeyDeclaration {
	/** Qualified key, or a prefix pattern ending in `*` (`acme.flags/flag:*`). */
	readonly id: QualifiedId;
	readonly scope: ContextKeyScope;
}

export type ContextKeyValues = Readonly<Record<string, boolean>>;

/**
 * Per-process context key values. Only the declaring owner may set a key.
 * Window-scoped keys live only in the window that sets them; global keys are
 * set in main and mirrored to every window.
 */
export class ContextKeyStore {
	readonly #declarations: ContextKeyDeclaration[] = [];
	readonly #values = new Map<string, boolean>();
	readonly #listeners = new Set<(changedKeys: ReadonlySet<string>) => void>();

	declare(declaration: ContextKeyDeclaration): void {
		this.#declarations.push(declaration);
	}

	declarationFor(key: string): ContextKeyDeclaration | undefined {
		return this.#declarations.find((declaration) =>
			declaration.id.endsWith("*")
				? key.startsWith(declaration.id.slice(0, -1))
				: declaration.id === key,
		);
	}

	isDeclared(key: string): boolean {
		return this.declarationFor(key) !== undefined;
	}

	/** Set a key on behalf of `owner`. Throws when the key is undeclared or owned by someone else. */
	set(owner: string, key: QualifiedId, value: boolean): void {
		if (ownerOf(key) !== owner) {
			throw new Error(`Context key "${key}" is owned by "${ownerOf(key)}", not "${owner}".`);
		}
		if (!this.isDeclared(key)) {
			throw new Error(`Context key "${key}" is not declared.`);
		}
		this.#write(key, value);
	}

	/** Replace mirrored values for `scope` (used to sync global keys from main). */
	replaceScope(scope: ContextKeyScope, values: ContextKeyValues): void {
		const changed = new Set<string>();
		for (const key of [...this.#values.keys()]) {
			if (this.declarationFor(key)?.scope === scope && !(key in values)) {
				this.#values.delete(key);
				changed.add(key);
			}
		}
		for (const [key, value] of Object.entries(values)) {
			if (this.#values.get(key) !== value) {
				this.#values.set(key, value);
				changed.add(key);
			}
		}
		if (changed.size > 0) this.#notify(changed);
	}

	get(key: string): boolean {
		return this.#values.get(key) ?? false;
	}

	snapshot(scope?: ContextKeyScope): ContextKeyValues {
		const values: Record<string, boolean> = {};
		for (const [key, value] of this.#values) {
			if (scope === undefined || this.declarationFor(key)?.scope === scope) values[key] = value;
		}
		return values;
	}

	evaluate(when: WhenExpression | undefined): boolean {
		return evaluateWhen(when, (key) => this.get(key));
	}

	/** Notified after values change, with the keys whose value changed. */
	subscribe(listener: (changedKeys: ReadonlySet<string>) => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	#write(key: string, value: boolean): void {
		if (this.#values.get(key) === value) return;
		this.#values.set(key, value);
		this.#notify(new Set([key]));
	}

	#notify(changedKeys: ReadonlySet<string>): void {
		for (const listener of [...this.#listeners]) listener(changedKeys);
	}
}

export function evaluateWhen(
	when: WhenExpression | undefined,
	read: (key: string) => boolean,
): boolean {
	if (!when) return true;
	return (when.all ?? []).every(read) && !(when.none ?? []).some(read);
}

export function whenKeys(when: WhenExpression | undefined): string[] {
	return [...(when?.all ?? []), ...(when?.none ?? [])];
}
