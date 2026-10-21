import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type { SDK } from "@kilo-desktop/feature-sdk";
import type {
	AnacondaAccountCapabilities,
	AnacondaAccountResult,
	AnacondaAccountSession,
} from "@kilo-desktop/plugin-anaconda-account/contracts";

// Type-only: the anaconda-account plugin is optional at runtime; when it is
// absent the capability lookup is null and the catalog falls back to its
// generic error.
export interface CatalogAnacondaAccount {
	/** False when the anaconda-account plugin is not installed/active. */
	available: boolean;
	session: AnacondaAccountSession;
	resolving: boolean;
	signingIn: boolean;
	signIn(): Promise<AnacondaAccountResult>;
	cancelSignIn(): Promise<void>;
}

const UNAVAILABLE_SESSION: AnacondaAccountSession = { status: "anonymous" };
const noopSubscribe = () => () => undefined;
const unavailablePeek = () => UNAVAILABLE_SESSION;
const unavailableSignIn = async (): Promise<AnacondaAccountResult> => ({
	ok: false,
	reason: "Anaconda sign-in is unavailable.",
});

/** The Anaconda account as the model catalog needs it, tolerating a missing provider. */
export function useCatalogAnacondaAccount(sdk: Pick<SDK, "plugins">): CatalogAnacondaAccount {
	const account = sdk.plugins.get<AnacondaAccountCapabilities>("anaconda-account")?.account;
	const session = useSyncExternalStore(
		account?.subscribe ?? noopSubscribe,
		account?.peek ?? unavailablePeek,
		account?.peek ?? unavailablePeek,
	);
	// Keyed by capability identity so a provider that registers (or re-registers)
	// after the first render starts out resolving rather than "settled".
	const [resolvedFor, setResolvedFor] = useState<object | undefined>(undefined);
	const resolving = account !== undefined && resolvedFor !== account;
	const [signingIn, setSigningIn] = useState(false);

	useEffect(() => {
		if (!account) return;
		let cancelled = false;
		const settle = () => {
			if (!cancelled) setResolvedFor(account);
		};
		void account.getSession().then(settle, settle);
		return () => {
			cancelled = true;
		};
	}, [account]);

	const signIn = useCallback(async (): Promise<AnacondaAccountResult> => {
		if (!account) return unavailableSignIn();
		setSigningIn(true);
		try {
			return await account.signIn();
		} finally {
			setSigningIn(false);
		}
	}, [account]);

	const cancelSignIn = useCallback(async (): Promise<void> => {
		await account?.cancelSignIn();
	}, [account]);

	return { available: account !== undefined, session, resolving, signingIn, signIn, cancelSignIn };
}

/**
 * Identifies whose Anaconda key the catalog would be fetched with. Part of the
 * catalog query key, so signing in, out, or switching accounts never serves a
 * catalog cached under a different key (the query cache outlives the dialog).
 */
export function catalogAccountKey(account: CatalogAnacondaAccount): string {
	if (!account.available) return "unavailable";
	const { session } = account;
	if (session.status !== "authenticated") return session.status;
	return `user:${session.user.userId ?? session.user.email ?? ""}`;
}
