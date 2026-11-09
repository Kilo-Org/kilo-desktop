import { useMemo } from "react";

import { KernelClipboard, KernelOs } from "@kilo-desktop/kernel";
import { useContextKey, useDomain, useDomainState } from "@kilo-desktop/kernel/web";

import {
	Identity,
	type DeviceAuthState,
	type IdentityState,
	type KiloProfileData,
} from "../contracts";

export interface KiloAuthContextValue {
	/** True while waiting for the first account read. */
	readonly isLoading: boolean;
	/** The Kilo server can't be reached (browser mode, kilo.agent not running, or it failed to start). */
	readonly connectionUnavailable: boolean;
	/** Why the account can't be read, while `connectionUnavailable`. */
	readonly unavailableMessage: string;
	/** Whether a sign-in can start right now. */
	readonly canSignIn: boolean;
	/** Null while loading; otherwise whether Kilo credentials are present. */
	readonly authenticated: boolean | null;
	readonly profile: KiloProfileData | null;
	readonly profileError: string | null;
	readonly deviceAuth: DeviceAuthState;
	readonly orgError: IdentityState["orgError"];
	readonly isRefreshing: boolean;
	readonly isSwitchingOrg: boolean;
	login(): void;
	cancelLogin(): void;
	logout(): void;
	refreshProfile(): void;
	setOrganization(organizationId: string | null): void;
	dismissOrgError(): void;
	openExternal(url: string): void;
	copyText(text: string): void;
}

const UNAVAILABLE: IdentityState = {
	connection: "unavailable",
	authenticated: null,
	profile: null,
	profileError: null,
	deviceAuth: { status: "idle" },
	orgError: null,
	isRefreshing: false,
	isSwitchingOrg: false,
};

const selectIdentity = (state: IdentityState) => state;
const ignore = () => undefined;

/**
 * The Kilo account for UI: kilo.account's identity domain plus its actions.
 * Without the domain (browser mode) the account reads as unavailable.
 */
export function useKiloAuth(): KiloAuthContextValue {
	const identity = useDomain(Identity);
	const state = useDomainState(Identity, selectIdentity) ?? UNAVAILABLE;
	const os = useDomain(KernelOs);
	const clipboard = useDomain(KernelClipboard);
	// In the desktop app the account is read through kilo.agent's server, so
	// it is unavailable whenever that plugin isn't running (or is turned off).
	const desktop = useContextKey("kernel/desktop");

	return useMemo(() => {
		const call = (run: (methods: NonNullable<typeof identity>["methods"]) => Promise<unknown>) => {
			if (identity) void run(identity.methods).catch(ignore);
		};
		return {
			isLoading:
				state.connection === "pending" ||
				(state.connection === "connected" && state.authenticated === null) ||
				(state.authenticated === true && !state.profile && !state.profileError),
			connectionUnavailable: state.connection === "unavailable",
			unavailableMessage: desktop
				? "Unavailable while the Kilo agent isn't running."
				: "Available in the desktop app.",
			canSignIn: state.connection === "connected",
			authenticated: state.authenticated,
			profile: state.authenticated ? state.profile : null,
			profileError: state.profileError,
			deviceAuth: state.deviceAuth,
			orgError: state.orgError,
			isRefreshing: state.isRefreshing,
			isSwitchingOrg: state.isSwitchingOrg,
			login: () => call((methods) => methods.signIn(undefined)),
			cancelLogin: () => call((methods) => methods.cancelSignIn(undefined)),
			logout: () => call((methods) => methods.signOut(undefined)),
			refreshProfile: () => call((methods) => methods.refresh(undefined)),
			setOrganization: (organizationId) =>
				call((methods) => methods.setOrganization({ organizationId })),
			dismissOrgError: () => call((methods) => methods.dismissOrgError(undefined)),
			openExternal: (url) => void os?.methods.openExternal({ url }).catch(ignore),
			copyText: (text) => void clipboard?.methods.writeText({ text }).catch(ignore),
		};
	}, [clipboard, desktop, identity, os, state]);
}
