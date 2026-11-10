import { useCallback, useEffect, useState } from "react";

import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import { useDomainObjectState } from "@kilo-desktop/kernel/web";

import {
	AnacondaAccount,
	type AnacondaAccountResult,
	type AnacondaAccountSession,
	type AnacondaAccountState,
} from "../contracts";

export interface AnacondaAccountView {
	session: AnacondaAccountSession;
	/** True until the first resolve lands, so the row does not flash "Not signed in". */
	resolving: boolean;
	/** The in-flight action, if any; a sign-in started in another window counts. */
	pending: "sign-in" | "sign-out" | null;
	signIn(): Promise<AnacondaAccountResult>;
	cancelSignIn(): Promise<void>;
	signOut(): Promise<AnacondaAccountResult>;
}

const ANONYMOUS: AnacondaAccountSession = { status: "anonymous" };
const selectSession = (state: AnacondaAccountState) => state.session;
const selectSigningIn = (state: AnacondaAccountState) => state.signingIn;

/**
 * React view of the Anaconda account domain object. Mounting re-checks the
 * stored key, so a key added or removed by another tool (e.g. `anaconda
 * login`) shows without a restart. Sign-in and sign-out never throw.
 */
export function useAnacondaAccount(
	account: DomainObjectHandle<typeof AnacondaAccount>,
): AnacondaAccountView {
	const session = useDomainObjectState(AnacondaAccount, selectSession) ?? ANONYMOUS;
	const signingIn = useDomainObjectState(AnacondaAccount, selectSigningIn) ?? false;
	const [resolving, setResolving] = useState(true);
	const [signingOut, setSigningOut] = useState(false);

	useEffect(() => {
		let cancelled = false;
		const settle = () => {
			if (!cancelled) setResolving(false);
		};
		void account.methods.refresh(undefined).then(settle, settle);
		return () => {
			cancelled = true;
		};
	}, [account]);

	const signIn = useCallback(() => account.methods.signIn(undefined).catch(failure), [account]);
	const cancelSignIn = useCallback(
		() => account.methods.cancelSignIn(undefined).catch(() => undefined),
		[account],
	);
	const signOut = useCallback(async () => {
		setSigningOut(true);
		try {
			return await account.methods.signOut(undefined).catch(failure);
		} finally {
			setSigningOut(false);
		}
	}, [account]);

	const pending = signingIn ? "sign-in" : signingOut ? "sign-out" : null;
	return { session, resolving, pending, signIn, cancelSignIn, signOut };
}

function failure(cause: unknown): AnacondaAccountResult {
	return { ok: false, reason: cause instanceof Error ? cause.message : String(cause) };
}
