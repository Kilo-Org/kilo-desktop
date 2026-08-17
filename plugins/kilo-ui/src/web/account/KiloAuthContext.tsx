import { createContext, useContext } from "react";

import type { DeviceAuthState, KiloOrgError, KiloProfileData } from "./kilo-auth.js";

export type KiloAuthContextValue = {
	/** True while waiting for the first auth-status / profile fetch. */
	isLoading: boolean;
	/** Kilo server connection is unavailable (browser mode or spawn failure). */
	connectionUnavailable: boolean;
	/** Null while loading; otherwise whether Gateway credentials are present. */
	authenticated: boolean | null;
	profile: KiloProfileData | null;
	/** Set when authenticated but the profile query failed (no cached profile). */
	profileError: string | null;
	deviceAuth: DeviceAuthState;
	/** Org-switch failure; independent of the device-OAuth login state machine. */
	orgError: KiloOrgError | null;
	isRefreshing: boolean;
	isSwitchingOrg: boolean;
	login: () => void;
	cancelLogin: () => void;
	logout: () => void;
	refreshProfile: () => void;
	setOrganization: (organizationId: string | null) => void;
	dismissOrgError: () => void;
	openExternal: (url: string) => void;
};

export const KiloAuthContext = createContext<KiloAuthContextValue | null>(null);

export function useKiloAuth(): KiloAuthContextValue {
	const value = useContext(KiloAuthContext);
	if (!value) {
		throw new Error("useKiloAuth requires KiloAuthProvider");
	}
	return value;
}
