import {
	mainHost,
	type DomainObjectProvider,
	type KvStore,
	type PluginSdk,
} from "@kilo-desktop/kernel";

import { ONBOARDING_VERSION, Onboarding, type OnboardingState } from "../contracts";

const SKIPPED: OnboardingState = { outcome: "skipped", version: ONBOARDING_VERSION };

interface OnboardingStore extends Record<string, unknown> {
	onboarding: OnboardingState;
	/** Origin's (kilo-ui's) outcome was taken over (once). */
	importedFromOrigin?: boolean;
}

export interface OnboardingOptions {
	/** Reads the outcome origin's kilo-ui saved; null when there is none. */
	readonly readOriginOnboarding?: (sdk: PluginSdk) => string | null;
}

/**
 * Persists whether onboarding was finished or skipped (kilo.shell's kv). The
 * renderer host decides when to show it; analytics come from the events.
 * `KILO_SKIP_ONBOARDING=1` (packaged e2e) reports it skipped without writing
 * the profile, so the overlay never blocks a test.
 */
export function provideOnboarding(sdk: PluginSdk, options: OnboardingOptions = {}): void {
	const skipForE2e = globalThis.process?.env?.["KILO_SKIP_ONBOARDING"] === "1";
	const store = skipForE2e
		? undefined
		: mainHost(sdk).storage.kv<OnboardingStore>({
				namespace: "onboarding",
				defaults: { onboarding: { outcome: null, version: null } },
			});
	const readOrigin = options.readOriginOnboarding;
	if (store && readOrigin) {
		try {
			importOriginOnboarding(store, () => readOrigin(sdk));
		} catch (error) {
			sdk.logger.warn(
				`Could not import origin's onboarding outcome; will try again next launch: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	const onboarding: DomainObjectProvider<typeof Onboarding> = sdk.domainObjects.provide(
		Onboarding,
		{
			initialState: store?.get("onboarding") ?? SKIPPED,
			methods: {
				complete: () => record("completed"),
				skip: () => record("skipped"),
				markShown: () => onboarding.emit("shown", {}),
			},
		},
	);

	function record(outcome: "completed" | "skipped"): void {
		const next: OnboardingState = { outcome, version: ONBOARDING_VERSION };
		store?.set({ onboarding: next });
		onboarding.setState(next);
		onboarding.emit(outcome, {});
	}
}

/**
 * Takes over origin's flat `{outcome, closedAt, version}` record once, without
 * overwriting an outcome recorded here. Origin's records written before
 * versioning have no `version`; null keeps them at v1, as origin read them.
 */
function importOriginOnboarding(store: KvStore<OnboardingStore>, read: () => string | null): void {
	if (store.get("importedFromOrigin") === true) return;
	const origin = parseOrigin(read());
	const adopt = origin !== null && store.get("onboarding").outcome === null;
	store.set({ ...(adopt ? { onboarding: origin } : {}), importedFromOrigin: true });
}

function parseOrigin(raw: string | null): OnboardingState | null {
	if (raw === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return null;
	const { outcome, version } = parsed as Record<string, unknown>;
	if (outcome !== "completed" && outcome !== "skipped") return null;
	return { outcome, version: typeof version === "number" ? version : null };
}
