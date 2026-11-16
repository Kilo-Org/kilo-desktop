import { useCallback } from "react";

import { useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import { KiloAccount, type AccountState } from "@kilo-desktop/plugin-core/contracts";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

/** kilo.shell's settings section for the Kilo account. */
export const ACCOUNT_SETTINGS_SECTION = "kilo.shell/account";

const selectNeedsSignIn = (state: AccountState) =>
	state.connection === "connected" &&
	state.signedIn === false &&
	state.deviceSignIn.status === "idle";

/**
 * Whether the person must sign in to Kilo to use the Kilo Gateway, and how:
 * starts kilo.core's device sign-in and opens Account settings, where it
 * shows its progress (as origin did).
 */
export function useKiloSignIn(): { needsSignIn: boolean; signIn: () => void } {
	const account = useDomainObject(KiloAccount);
	const navigation = useDomainObject(Navigation);
	const needsSignIn = useDomainObjectState(KiloAccount, selectNeedsSignIn) ?? false;
	const signIn = useCallback(() => {
		void account?.methods.signIn(undefined).catch(() => undefined);
		void navigation?.methods
			.openSettings({ section: ACCOUNT_SETTINGS_SECTION })
			.catch(() => undefined);
	}, [account, navigation]);
	return { needsSignIn, signIn };
}
