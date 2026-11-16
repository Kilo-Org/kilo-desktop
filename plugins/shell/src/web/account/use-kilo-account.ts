import { useMemo } from "react";

import { KernelClipboard, KernelOs } from "@kilo-desktop/kernel";
import { useContextKey, useDomainObject, useDomainObjectState } from "@kilo-desktop/kernel/web";
import {
	KiloAccount,
	type AccountState,
	type DeviceSignInState,
	type KiloProfile,
} from "@kilo-desktop/plugin-core/contracts";

export interface KiloAccountView {
	/** True while waiting for the first account read. */
	readonly isLoading: boolean;
	/** The Kilo server can't be reached (browser mode, kilo.core not running, or it failed to start). */
	readonly connectionUnavailable: boolean;
	/** Why the account can't be read, while `connectionUnavailable`. */
	readonly unavailableMessage: string;
	/** Null while loading; otherwise whether Kilo credentials are present. */
	readonly signedIn: boolean | null;
	readonly profile: KiloProfile | null;
	readonly profileError: string | null;
	readonly deviceSignIn: DeviceSignInState;
	readonly organizationError: AccountState["organizationError"];
	readonly refreshing: boolean;
	readonly switchingOrganization: boolean;
	signIn(): void;
	cancelSignIn(): void;
	signOut(): void;
	refresh(): void;
	setOrganization(organizationId: string | null): void;
	openExternal(url: string): void;
	copyText(text: string): void;
}

const UNAVAILABLE: AccountState = {
	connection: "unavailable",
	signedIn: null,
	profile: null,
	profileError: null,
	deviceSignIn: { status: "idle" },
	organizationError: null,
	refreshing: false,
	switchingOrganization: false,
};

const selectAccount = (state: AccountState) => state;
const ignore = () => undefined;

/**
 * The Kilo account for UI: kilo.core's account domain object plus its
 * actions. Without it (browser mode, kilo.core off) the account reads as
 * unavailable.
 */
export function useKiloAccount(): KiloAccountView {
	const account = useDomainObject(KiloAccount);
	const state = useDomainObjectState(KiloAccount, selectAccount) ?? UNAVAILABLE;
	const os = useDomainObject(KernelOs);
	const clipboard = useDomainObject(KernelClipboard);
	const desktop = useContextKey("kernel/desktop");

	return useMemo(() => {
		const call = (run: (methods: NonNullable<typeof account>["methods"]) => Promise<unknown>) => {
			if (account) void run(account.methods).catch(ignore);
		};
		return {
			isLoading:
				state.connection === "pending" ||
				(state.connection === "connected" && state.signedIn === null) ||
				(state.signedIn === true && !state.profile && !state.profileError),
			connectionUnavailable: state.connection === "unavailable",
			unavailableMessage: desktop
				? "Unavailable while the Kilo server isn't running."
				: "Available in the desktop app.",
			signedIn: state.signedIn,
			profile: state.signedIn ? state.profile : null,
			profileError: state.profileError,
			deviceSignIn: state.deviceSignIn,
			organizationError: state.organizationError,
			refreshing: state.refreshing,
			switchingOrganization: state.switchingOrganization,
			signIn: () => call((methods) => methods.signIn(undefined)),
			cancelSignIn: () => call((methods) => methods.cancelSignIn(undefined)),
			signOut: () => call((methods) => methods.signOut(undefined)),
			refresh: () => call((methods) => methods.refresh(undefined)),
			setOrganization: (organizationId) =>
				call((methods) => methods.setOrganization({ organizationId })),
			openExternal: (url) => void os?.methods.openExternal({ url }).catch(ignore),
			copyText: (text) => void clipboard?.methods.writeText({ text }).catch(ignore),
		};
	}, [account, clipboard, desktop, os, state]);
}
