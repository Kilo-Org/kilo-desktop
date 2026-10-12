import type { KvStore, MainSdk } from "@kilo-desktop/feature-sdk";

import { KILO_TERMS_VERSION, type TermsAcceptance } from "../../contracts/onboarding/schemas.js";

export interface PersistedTerms extends Record<string, unknown> {
	version: string | null;
	acceptedAt: number | null;
	linkedAccounts: string[];
}

const DEFAULTS: PersistedTerms = { version: null, acceptedAt: null, linkedAccounts: [] };

const NAMESPACE = "terms-acceptance";

export type TermsStorage = Pick<KvStore<PersistedTerms>, "snapshot" | "set">;

export function createInMemoryTermsStorage(
	initial: PersistedTerms = { ...DEFAULTS, linkedAccounts: [] },
): TermsStorage {
	let value: PersistedTerms = initial;
	return {
		snapshot: () => value,
		set: (patch) => {
			value = { ...value, ...patch };
			return value;
		},
	};
}

/**
 * Local record of terms-of-service acceptance, file-backed via
 * `mainSdk.storage.kv` in its own namespace so onboarding outcome writes never
 * touch it.
 *
 * Invariants: re-accepting the same version keeps the original `acceptedAt`
 * (the first acceptance is the record); accepting a new version starts a fresh
 * record with no linked accounts, so the new acceptance is attributed again.
 * `linkedAccounts` holds opaque account hashes — never emails — and only
 * grows. It lets the renderer send each signed-in account one explicit
 * acceptance marker ("Terms Acceptance Linked"), which covers what the
 * telemetry alias to the signed-in email doesn't: sign-ins on a later launch
 * and additional accounts on the same install.
 *
 * Desktop persists through durable KV; browser mode (the dev harness) has no
 * KV, so it injects {@link createInMemoryTermsStorage}, seeded as accepted.
 * `KILO_SKIP_ONBOARDING=1` (packaged e2e, like `OnboardingStore`) swaps in
 * memory storage seeded with the current terms, so the terms gate stays out of
 * the way without writing to the profile.
 */
export class TermsAcceptanceStore {
	readonly #store: TermsStorage;
	readonly #now: () => number;

	constructor(
		sdk: MainSdk,
		options: {
			now?: () => number;
			storage?: TermsStorage;
			env?: Record<string, string | undefined>;
		} = {},
	) {
		this.#now = options.now ?? Date.now;
		this.#store =
			options.storage ??
			(options.env?.KILO_SKIP_ONBOARDING === "1"
				? createInMemoryTermsStorage({
						version: KILO_TERMS_VERSION,
						acceptedAt: 1,
						linkedAccounts: [],
					})
				: sdk.storage.kv<PersistedTerms>({ namespace: NAMESPACE, defaults: DEFAULTS }));
	}

	get(): TermsAcceptance | null {
		const snapshot = this.#store.snapshot();
		if (typeof snapshot.version !== "string" || typeof snapshot.acceptedAt !== "number") {
			return null;
		}
		const linkedAccounts = Array.isArray(snapshot.linkedAccounts)
			? snapshot.linkedAccounts.filter((key): key is string => typeof key === "string")
			: [];
		return { version: snapshot.version, acceptedAt: snapshot.acceptedAt, linkedAccounts };
	}

	accept(version: string, accountKey?: string): TermsAcceptance {
		const current = this.get();
		const base: TermsAcceptance =
			current?.version === version
				? current
				: { version, acceptedAt: this.#now(), linkedAccounts: [] };
		return this.#write(withAccount(base, accountKey));
	}

	markLinked(accountKey: string): TermsAcceptance | null {
		const current = this.get();
		if (!current) return null;
		return this.#write(withAccount(current, accountKey));
	}

	#write(next: TermsAcceptance): TermsAcceptance {
		this.#store.set({ ...next, linkedAccounts: [...next.linkedAccounts] });
		return next;
	}
}

function withAccount(acceptance: TermsAcceptance, accountKey: string | undefined): TermsAcceptance {
	if (accountKey === undefined || acceptance.linkedAccounts.includes(accountKey)) {
		return acceptance;
	}
	return { ...acceptance, linkedAccounts: [...acceptance.linkedAccounts, accountKey] };
}
