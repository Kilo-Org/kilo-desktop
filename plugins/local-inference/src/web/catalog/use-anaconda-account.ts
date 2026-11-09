import { useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	createElement,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
	useSyncExternalStore,
	type ReactNode,
} from "react";

import type { DomainHandle } from "@kilo-desktop/kernel";
import { useDomain } from "@kilo-desktop/kernel/web";
import {
	AnacondaAccount,
	type AnacondaAccountResult,
	type AnacondaAccountSession,
} from "@kilo-desktop/plugin-anaconda-account/contracts";

import { localInferenceQueryKey } from "../local-inference.js";

export type { AnacondaAccountResult, AnacondaAccountSession };

/** The Anaconda account the catalog's API key comes with, as the catalog uses it. */
export interface AnacondaAccountProvider {
	subscribe(listener: (session: AnacondaAccountSession) => void): () => void;
	peek(): AnacondaAccountSession;
	getSession(): Promise<AnacondaAccountSession>;
	signIn(): Promise<AnacondaAccountResult>;
	cancelSignIn(): Promise<void>;
}

/**
 * Where the catalog finds the Anaconda account: kilo.anaconda-account's
 * domain object, provided by {@link AnacondaAccountBoundary}. Without it
 * (the plugin removed) the catalog falls back to its generic error.
 */
export const AnacondaAccountContext = createContext<AnacondaAccountProvider | undefined>(undefined);

/** Adapts `kilo.anaconda-account/account` to the catalog's provider shape. */
export function anacondaAccountProvider(
	account: DomainHandle<typeof AnacondaAccount>,
): AnacondaAccountProvider {
	return {
		subscribe: (listener) => account.subscribe((state) => listener(state.session)),
		peek: () => account.getState().session,
		getSession: () => account.methods.session(undefined),
		signIn: () => account.methods.signIn(undefined),
		cancelSignIn: () => account.methods.cancelSignIn(undefined),
	};
}

/**
 * Provides the Anaconda account to the catalog, and refetches the catalog
 * whenever the account's key changes (a sign-in, sign-out or rotated key).
 */
export function AnacondaAccountBoundary({ children }: { children: ReactNode }) {
	const account = useDomain(AnacondaAccount);
	const queryClient = useQueryClient();
	const provider = useMemo(
		() => (account ? anacondaAccountProvider(account) : undefined),
		[account],
	);

	useEffect(
		() =>
			account?.on("changed", () => {
				void queryClient.invalidateQueries({ queryKey: localInferenceQueryKey("listCatalog") });
			}),
		[account, queryClient],
	);

	return createElement(AnacondaAccountContext.Provider, { value: provider }, children);
}

export interface CatalogAnacondaAccount {
	/** False when no Anaconda account is provided. */
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
export function useCatalogAnacondaAccount(): CatalogAnacondaAccount {
	const account = useContext(AnacondaAccountContext);
	const session = useSyncExternalStore(
		account?.subscribe ?? noopSubscribe,
		account?.peek ?? unavailablePeek,
		account?.peek ?? unavailablePeek,
	);
	// Keyed by provider identity so a provider that registers (or re-registers)
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
		} catch (cause) {
			return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
		} finally {
			setSigningIn(false);
		}
	}, [account]);

	const cancelSignIn = useCallback(async (): Promise<void> => {
		await account?.cancelSignIn().catch(() => undefined);
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
