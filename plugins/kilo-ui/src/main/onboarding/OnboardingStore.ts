import type { KvStore, MainSdk } from "@kilo-desktop/feature-sdk";

import { ONBOARDING_VERSION, type OnboardingState } from "../../contracts/onboarding/schemas.js";

interface PersistedOnboarding extends Record<string, unknown> {
	outcome: OnboardingState["outcome"];
	closedAt: number | null;
	version: number | null;
}

const DEFAULTS: PersistedOnboarding = { outcome: null, closedAt: null, version: null };

const NAMESPACE = "onboarding";

const SKIPPED: OnboardingState = { outcome: "skipped", closedAt: 1, version: ONBOARDING_VERSION };

/**
 * First-run onboarding persistence. File-backed via `mainSdk.storage.kv`.
 * `KILO_SKIP_ONBOARDING=1` short-circuits to skipped so packaged e2e
 * (one shared Electron profile per worker) is not blocked by the overlay.
 */
export class OnboardingStore {
	readonly #store: KvStore<PersistedOnboarding>;
	readonly #skip: boolean;
	readonly #now: () => number;

	constructor(sdk: MainSdk, env: NodeJS.ProcessEnv = process.env, now: () => number = Date.now) {
		this.#store = sdk.storage.kv<PersistedOnboarding>({
			namespace: NAMESPACE,
			defaults: DEFAULTS,
		});
		this.#skip = env.KILO_SKIP_ONBOARDING === "1";
		this.#now = now;
	}

	get(): OnboardingState {
		if (this.#skip) return SKIPPED;
		return this.#read();
	}

	complete(): OnboardingState {
		return this.#write("completed");
	}

	skip(): OnboardingState {
		return this.#write("skipped");
	}

	#read(): OnboardingState {
		const snapshot = this.#store.snapshot();
		const outcome =
			snapshot.outcome === "completed" || snapshot.outcome === "skipped" ? snapshot.outcome : null;
		const closedAt = typeof snapshot.closedAt === "number" ? snapshot.closedAt : null;
		// Records written before versioning have no `version`: they belong to v1.
		const version = typeof snapshot.version === "number" ? snapshot.version : null;
		return { outcome, closedAt, version };
	}

	#write(outcome: "completed" | "skipped"): OnboardingState {
		const next: PersistedOnboarding = {
			outcome,
			closedAt: this.#now(),
			version: ONBOARDING_VERSION,
		};
		this.#store.set(next);
		return { outcome: next.outcome, closedAt: next.closedAt, version: next.version };
	}
}
