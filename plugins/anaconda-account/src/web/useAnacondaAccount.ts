import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import type {
	AnacondaAccountCapability,
	AnacondaAccountResult,
	AnacondaAccountSession,
} from "../contracts/schemas.js";

export interface AnacondaAccount {
	session: AnacondaAccountSession;
	/** True until the first resolve lands, so callers can avoid flashing "Not signed in". */
	resolving: boolean;
	/** The in-flight user action, if any. */
	pending: "sign-in" | "sign-out" | null;
	signIn(): Promise<AnacondaAccountResult>;
	cancelSignIn(): Promise<void>;
	signOut(): Promise<AnacondaAccountResult>;
}

/**
 * React view of the Anaconda account capability: live session plus
 * pending/resolving state. Mounting re-checks the stored key, so a key added or
 * removed by another tool (e.g. `anaconda login`) shows without a restart.
 */
export function useAnacondaAccount(account: AnacondaAccountCapability): AnacondaAccount {
	const session = useSyncExternalStore(account.subscribe, account.peek, account.peek);
	const [resolving, setResolving] = useState(true);
	const [pending, setPending] = useState<AnacondaAccount["pending"]>(null);

	useEffect(() => {
		let cancelled = false;
		const settle = () => {
			if (!cancelled) setResolving(false);
		};
		void account.refresh().then(settle, settle);
		return () => {
			cancelled = true;
		};
	}, [account]);

	const withPending = useCallback(
		async (
			action: "sign-in" | "sign-out",
			call: () => Promise<AnacondaAccountResult>,
		): Promise<AnacondaAccountResult> => {
			setPending(action);
			try {
				return await call();
			} finally {
				setPending(null);
			}
		},
		[],
	);

	const signIn = useCallback(
		() => withPending("sign-in", () => account.signIn()),
		[account, withPending],
	);
	const signOut = useCallback(
		() => withPending("sign-out", () => account.signOut()),
		[account, withPending],
	);

	const cancelSignIn = useCallback(() => account.cancelSignIn(), [account]);

	return { session, resolving, pending, signIn, cancelSignIn, signOut };
}
