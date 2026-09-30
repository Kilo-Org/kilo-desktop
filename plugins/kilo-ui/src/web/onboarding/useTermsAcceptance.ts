import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import type { AuthSession, SDK } from "@kilo-desktop/feature-sdk";
import { useSdkMutation, useSdkQuery } from "@kilo-desktop/sdk-react";

import type { OnboardingService, TermsAcceptance } from "../../contracts/onboarding/schemas.js";
import { KILO_TERMS_URL, KILO_TERMS_VERSION } from "../account/kilo-auth.js";

/**
 * Person properties marking the acceptance. `$set_once` keeps the first
 * acceptance on a person that already carries one.
 */
function termsProperties(acceptance: TermsAcceptance): Record<string, unknown> {
	return {
		termsVersion: acceptance.version,
		termsUrl: KILO_TERMS_URL,
		$set_once: {
			terms_accepted_at: new Date(acceptance.acceptedAt).toISOString(),
			terms_version: acceptance.version,
		},
	};
}

function signedInAccountId(session: AuthSession): string | null {
	if (session.status !== "authenticated") return null;
	return session.user.userId || session.user.email?.toLowerCase() || null;
}

/** Opaque, stable key for an account, so the local record never holds an email. */
async function accountKey(accountId: string): Promise<string> {
	const bytes = new TextEncoder().encode(`kilo-terms:${accountId}`);
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Records terms-of-service acceptance and attributes it to signed-in accounts
 * in telemetry.
 *
 * `record()` persists the acceptance locally and sends "Terms Accepted" — keyed
 * by email when a session already exists, otherwise by the install's anonymous
 * id. Whenever a session is authenticated, this also sends "Terms Acceptance
 * Linked" on that account once, setting the acceptance as person properties:
 * an explicit per-account acceptance marker.
 *
 * Desktop telemetry aliases the anonymous id into the email on an in-process
 * switch to a signed-in identity (`$create_alias`, #635), so a same-session
 * sign-in already merges the anonymous "Terms Accepted" into the user; the
 * marker is redundant there but harmless (`$set_once`). It is what attributes
 * the acceptance when the alias doesn't:
 * - a sign-in on a later launch, where the provider has no previous id in
 *   memory to alias from;
 * - a second account on the same install, whose alias PostHog refuses because
 *   the installation id already belongs to the first account's person.
 *
 * The session is read from `sdk.auth` — the same one main uses to resolve
 * telemetry identity — so the event is not sent before main can attribute it.
 * Telemetry is still subject to the user's data-collection setting; the local
 * record is not.
 */
export function useTermsAcceptance(sdk: SDK<OnboardingService>): { record: () => void } {
	const session = useSyncExternalStore(sdk.auth.subscribe, sdk.auth.peek, sdk.auth.peek);
	const accountId = signedInAccountId(session);
	const terms = useSdkQuery(sdk, "onboarding.terms.get");
	const { mutateAsync: acceptTerms } = useSdkMutation(sdk, "onboarding.terms.accept", {
		invalidates: ["onboarding.terms.get"],
	});
	const { mutateAsync: linkAccount } = useSdkMutation(sdk, "onboarding.terms.markLinked", {
		invalidates: ["onboarding.terms.get"],
	});
	const linking = useRef<string | null>(null);

	const record = useCallback(() => {
		const previous = terms.data ?? null;
		void (async () => {
			const key = accountId ? await accountKey(accountId) : undefined;
			const acceptance = await acceptTerms({
				version: KILO_TERMS_VERSION,
				...(key !== undefined ? { accountKey: key } : {}),
			});
			if (previous?.version === acceptance.version) return;
			await sdk.telemetry.track({ event: "Terms Accepted", data: termsProperties(acceptance) });
		})().catch(() => undefined);
	}, [acceptTerms, accountId, sdk.telemetry, terms.data]);

	const acceptance = terms.data ?? null;
	useEffect(() => {
		if (!accountId || !acceptance) return;
		let cancelled = false;
		void (async () => {
			const key = await accountKey(accountId);
			if (cancelled || acceptance.linkedAccounts.includes(key) || linking.current === key) return;
			linking.current = key;
			try {
				await sdk.telemetry.track({
					event: "Terms Acceptance Linked",
					data: termsProperties(acceptance),
				});
				await linkAccount({ accountKey: key });
			} finally {
				linking.current = null;
			}
		})().catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [acceptance, accountId, linkAccount, sdk.telemetry]);

	return { record };
}
