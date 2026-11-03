// Test fixture for plugins that contribute to kilo.account's points (e.g. a
// panel in Settings → Account): kilo.account's renderer as a guest of
// kilo.shell's test host, over a signed-out Kilo account that accepted the terms.
import type { PluginEntry } from "@kilo-desktop/kernel";

import manifest from "../../plugin.json";
import {
	ACCOUNT_DEFINITIONS,
	Identity,
	KILO_TERMS_VERSION,
	Terms,
	type IdentityState,
} from "../contracts";
import { accountWebEntry } from "../web";

const SIGNED_OUT: IdentityState = {
	connection: "connected",
	authenticated: false,
	profile: null,
	profileError: null,
	deviceAuth: { status: "idle" },
	orgError: null,
	isRefreshing: false,
	isSwitchingOrg: false,
};

const accountMain: PluginEntry = {
	activate(sdk) {
		sdk.domains.provide(Identity, {
			initialState: SIGNED_OUT,
			methods: {
				signIn: async () => ({ signedIn: false }),
				cancelSignIn: () => undefined,
				signOut: () => undefined,
				refresh: () => undefined,
				setOrganization: () => undefined,
				dismissOrgError: () => undefined,
			},
		});
		const acceptedAt = 1;
		sdk.domains.provide(Terms, {
			initialState: { version: KILO_TERMS_VERSION, accepted: true, acceptedAt },
			methods: {
				accept: ({ version }) => ({ version, accepted: true, acceptedAt }),
			},
		});
		sdk.context.set("termsAccepted", true);
	},
};

export const accountTestPlugin = {
	manifest,
	definitions: ACCOUNT_DEFINITIONS,
	main: accountMain,
	web: accountWebEntry,
};
