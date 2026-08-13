import { createContext, useContext } from "react";

import type { DeviceAuthState, KiloProfileData } from "./kilo-auth.js";

export type KiloAuthContextValue = {
	/** True while waiting for the first auth-status / profile fetch. */
	isLoading: boolean;
	/** Kilo server connection is unavailable (browser mode or spawn failure). */
	connectionUnavailable: boolean;
	/** Null while loading; otherwise whether Gateway credentials are present. */
	authenticated: boolean | null;
	profile: KiloProfileData | null;
	deviceAuth: DeviceAuthState;
	isRefreshing: boolean;
	isSwitchingOrg: boolean;
	login: () => void;
	cancelLogin: () => void;
	logout: () => void;
	refreshProfile: () => void;
	setOrganization: (organizationId: string | null) => void;
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
