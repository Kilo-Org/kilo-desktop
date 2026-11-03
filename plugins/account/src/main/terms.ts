import { createHash } from "node:crypto";

import type { KvStore } from "@kilo-desktop/kernel";

export interface PersistedTerms extends Record<string, unknown> {
	version: string | null;
	acceptedAt: number | null;
	/** SHA-256 hashes of the accounts the acceptance was reported for; never emails. */
	linkedAccounts: string[];
	/** Origin's (kilo-ui's) acceptance was taken over (once). */
	importedFromOrigin?: boolean;
}

export type TermsStorage = Pick<KvStore<PersistedTerms>, "snapshot" | "set">;

const EMPTY: PersistedTerms = { version: null, acceptedAt: null, linkedAccounts: [] };

export function inMemoryTerms(initial: PersistedTerms): TermsStorage {
	let value = initial;
	return {
		snapshot: () => value,
		set: (patch) => (value = { ...value, ...patch }),
	};
}

/**
 * An opaque key for an account, so its acceptance is reported once without
 * storing who it is. It matches the keys origin's kilo-ui saved (and this app
 * imports): origin hashed `userId || email.toLowerCase()`, and its session
 * (built from the Kilo profile) never carried a userId.
 */
export function accountHash(email: string): string {
	return createHash("sha256").update(`kilo-terms:${email.toLowerCase()}`).digest("hex");
}

function parseTerms(raw: string | null): Omit<PersistedTerms, "importedFromOrigin"> | null {
	if (raw === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const { version, acceptedAt, linkedAccounts } = parsed as Record<string, unknown>;
	if (typeof version !== "string" || typeof acceptedAt !== "number") return null;
	return {
		version,
		acceptedAt,
		linkedAccounts: Array.isArray(linkedAccounts)
			? linkedAccounts.filter((key): key is string => typeof key === "string")
			: [],
	};
}

/**
 * Local record of the terms of service being accepted. Re-accepting the same
 * version keeps the first acceptance time (the first acceptance is the
 * record); a new version starts afresh, with no linked accounts, so it is
 * accepted and reported again.
 */
export class TermsRecord {
	readonly #store: TermsStorage;
	readonly #now: () => number;

	constructor(store: TermsStorage, now: () => number) {
		this.#store = store;
		this.#now = now;
	}

	static empty(): PersistedTerms {
		return { ...EMPTY, linkedAccounts: [] };
	}

	acceptedAt(version: string): number | null {
		const saved = this.#store.snapshot();
		return saved.version === version && typeof saved.acceptedAt === "number"
			? saved.acceptedAt
			: null;
	}

	/** Records acceptance; true when this is the first acceptance of `version`. */
	accept(version: string): boolean {
		if (this.acceptedAt(version) !== null) return false;
		this.#store.set({ version, acceptedAt: this.#now(), linkedAccounts: [] });
		return true;
	}

	/**
	 * Takes over the acceptance origin's kilo-ui saved (same shape), once and
	 * without overwriting one made here. `readOrigin` returns null when origin
	 * saved nothing; when it throws, the import is left to retry next launch.
	 * An imported acceptance is not a new one, so nothing is reported for it.
	 */
	importOrigin(readOrigin: () => string | null): void {
		const saved = this.#store.snapshot();
		if (saved.importedFromOrigin === true) return;
		const origin = parseTerms(readOrigin());
		const adopt = saved.version === null && origin !== null;
		this.#store.set({ ...(adopt ? origin : {}), importedFromOrigin: true });
	}

	/** Marks the acceptance as reported for an account; true the first time. */
	link(accountKey: string): boolean {
		const saved = this.#store.snapshot();
		const linked = Array.isArray(saved.linkedAccounts) ? saved.linkedAccounts : [];
		if (linked.includes(accountKey)) return false;
		this.#store.set({ linkedAccounts: [...linked, accountKey] });
		return true;
	}
}
