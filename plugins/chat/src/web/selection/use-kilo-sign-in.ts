import { useCallback } from "react";

import { useDomain, useDomainState } from "@kilo-desktop/kernel/web";
import { Identity, type IdentityState } from "@kilo-desktop/plugin-account/contracts";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

const selectNeedsSignIn = (state: IdentityState) =>
	state.connection === "connected" &&
	state.authenticated === false &&
	state.deviceAuth.status === "idle";

/**
 * Whether the person must sign in to Kilo to use the Kilo Gateway, and how:
 * starts kilo.account's device sign-in and opens Account settings, where it
 * shows its progress (as origin did).
 */
export function useKiloSignIn(): { needsSignIn: boolean; signIn: () => void } {
	const identity = useDomain(Identity);
	const navigation = useDomain(Navigation);
	const needsSignIn = useDomainState(Identity, selectNeedsSignIn) ?? false;
	const signIn = useCallback(() => {
		void identity?.methods.signIn(undefined).catch(() => undefined);
		void navigation?.methods.openSettings({ section: "account" }).catch(() => undefined);
	}, [identity, navigation]);
	return { needsSignIn, signIn };
}
