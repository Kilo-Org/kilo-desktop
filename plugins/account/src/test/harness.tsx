// Test harness: kilo.account's renderer on the shell test host, over a fake account.
import { vi } from "vitest";

import {
	KernelClipboard,
	KernelOs,
	type DomainProvider,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import { renderShell, type GuestPlugin } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../plugin.json";
import {
	ACCOUNT_DEFINITIONS,
	Identity,
	KILO_TERMS_VERSION,
	Terms,
	type IdentityState,
	type KiloProfileData,
} from "../contracts";
import { accountWebEntry } from "../web/index";

export const PROFILE: KiloProfileData = {
	profile: {
		email: "ada@example.com",
		name: "Ada Lovelace",
		organizations: [{ id: "org-1", name: "Analytical Engines", role: "billing_admin" }],
		hasPersonalAccount: true,
	},
	balance: { balance: 12.5 },
	kiloPass: {
		currentPeriodBaseCreditsUsd: 20,
		currentPeriodUsageUsd: 5,
		currentPeriodBonusCreditsUsd: 0,
	},
	currentOrgId: null,
};

export const SIGNED_OUT: IdentityState = {
	connection: "connected",
	authenticated: false,
	profile: null,
	profileError: null,
	deviceAuth: { status: "idle" },
	orgError: null,
	isRefreshing: false,
	isSwitchingOrg: false,
};

export const SIGNED_IN: IdentityState = { ...SIGNED_OUT, authenticated: true, profile: PROFILE };

/** Stands in for kilo.account's main entry: an account the test controls. */
function fakeAccountMain(initial: IdentityState, termsAccepted: boolean) {
	const methods = {
		signIn: vi.fn(async () => ({ signedIn: false })),
		cancelSignIn: vi.fn(),
		signOut: vi.fn(),
		refresh: vi.fn(),
		setOrganization: vi.fn(),
		dismissOrgError: vi.fn(),
	};
	const accept = vi.fn();
	let setIdentity: (state: IdentityState) => void = () => {};
	const entry: PluginEntry = {
		activate(sdk) {
			const identity = sdk.domains.provide(Identity, { initialState: initial, methods });
			setIdentity = (state) => identity.setState(state);
			const terms: DomainProvider<typeof Terms> = sdk.domains.provide(Terms, {
				initialState: { version: KILO_TERMS_VERSION, accepted: termsAccepted, acceptedAt: null },
				methods: {
					accept: ({ version }) => {
						accept(version);
						sdk.context.set("termsAccepted", true);
						terms.setState({ version, accepted: true, acceptedAt: 1 });
						return terms.state;
					},
				},
			});
			sdk.context.set("termsAccepted", termsAccepted);
		},
	};
	return { entry, methods, accept, setIdentity: (state: IdentityState) => setIdentity(state) };
}

/** Boots kilo.shell with kilo.account's renderer over a fake account. */
export async function renderApp(
	options: {
		identity?: IdentityState;
		termsAccepted?: boolean;
		onboarding?: boolean;
		guests?: readonly GuestPlugin[];
		path?: string;
		/** False for browser mode; defaults to the desktop app. */
		desktop?: boolean;
	} = {},
) {
	const account = fakeAccountMain(options.identity ?? SIGNED_OUT, options.termsAccepted ?? true);
	const openExternal = vi.fn(() => true);
	const writeText = vi.fn();
	const host = await renderShell(
		[
			{ manifest, definitions: ACCOUNT_DEFINITIONS, main: account.entry, web: accountWebEntry },
			...(options.guests ?? []),
		],
		{
			desktop: options.desktop ?? true,
			onboarding: options.onboarding === true,
			beforeRender: (main) => {
				main.kernelSdk.domains.provide(KernelOs, {
					initialState: {},
					methods: {
						openExternal,
						showItemInFolder: () => {},
						showLogs: () => ({ revealed: true }),
						logFilePath: () => "/logs/main.log",
					},
				});
				main.kernelSdk.domains.provide(KernelClipboard, {
					initialState: {},
					methods: { writeText },
				});
			},
		},
	);
	if (options.path) window.location.hash = `#${options.path}`;
	return { ...account, openExternal, writeText, host };
}
