import type { PluginSdk } from "@kilo-desktop/kernel";

import { KiloAccount } from "../../contracts";

/** Whether a Kilo account is signed in, read from `kilo.core/account`. */
export interface SignedInState {
	isSignedIn(): boolean;
	/** Hears every change of `isSignedIn()`. */
	subscribe(listener: () => void): () => void;
}

/** Follows `kilo.core/account`'s `signedIn`; signed out while it is unknown or not provided. */
export function followSignedIn(sdk: PluginSdk): SignedInState {
	const listeners = new Set<() => void>();
	let signedIn = false;
	const set = (next: boolean) => {
		if (next === signedIn) return;
		signedIn = next;
		for (const listener of [...listeners]) listener();
	};
	let stopAccount: (() => void) | undefined;
	sdk.domainObjects.track(KiloAccount, {
		added(account) {
			set(account.getState().signedIn === true);
			stopAccount = account.subscribe((state) => set(state.signedIn === true));
		},
		removed() {
			stopAccount?.();
			stopAccount = undefined;
			set(false);
		},
	});
	return {
		isSignedIn: () => signedIn,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}
