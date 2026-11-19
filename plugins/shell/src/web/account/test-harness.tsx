// Test harness: the account area on a plugin host, over a kilo.core stand-in the test controls.
import type { ComponentType } from "react";
import { vi } from "vitest";

import {
	KernelClipboard,
	KernelOs,
	type DomainObjectProvider,
	type PluginEntry,
} from "@kilo-desktop/kernel";
import {
	createPluginHost,
	type HostedPlugin,
	type PluginHost,
} from "@kilo-desktop/kernel/testing/plugin-host";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import {
	CORE_DEFINITIONS,
	KILO_TERMS_VERSION,
	KiloAccount,
	KiloTerms,
	type AccountState,
	type KiloProfile,
} from "@kilo-desktop/plugin-core/contracts";
import { Dialog, DialogContent } from "@kilo-desktop/ui/components/dialog";
import { SidebarProvider } from "@kilo-desktop/ui/components/sidebar";

import shellManifest from "../../../plugin.json";
import {
	Navigation,
	OnboardingStep,
	SHELL_DEFINITIONS,
	SidebarNotice,
	type OnboardingStepImplementation,
} from "../../contracts";
import { activateAccount } from "./index";
import { signInStep, welcomeStep } from "./onboarding/steps";
import { SidebarAccount } from "./SidebarAccount";

export const PROFILE: KiloProfile = {
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

export const SIGNED_OUT: AccountState = {
	connection: "connected",
	signedIn: false,
	profile: null,
	profileError: null,
	deviceSignIn: { status: "idle" },
	organizationError: null,
	refreshing: false,
	switchingOrganization: false,
};

export const SIGNED_IN: AccountState = { ...SIGNED_OUT, signedIn: true, profile: PROFILE };

/** Stands in for kilo.core's main entry: an account and terms the test controls. */
function fakeCore(initial: AccountState, termsAccepted: boolean, acceptFails: boolean) {
	const methods = {
		signIn: vi.fn(async () => ({ signedIn: false })),
		cancelSignIn: vi.fn(),
		signOut: vi.fn(),
		refresh: vi.fn(),
		setOrganization: vi.fn(),
	};
	const accept = vi.fn();
	let setAccount: (state: AccountState) => void = () => {};
	const main: PluginEntry = {
		activate(sdk) {
			const account = sdk.domainObjects.provide(KiloAccount, { initialState: initial, methods });
			setAccount = (state) => account.setState(state);
			const terms: DomainObjectProvider<typeof KiloTerms> = sdk.domainObjects.provide(KiloTerms, {
				initialState: { version: KILO_TERMS_VERSION, accepted: termsAccepted, acceptedAt: null },
				methods: {
					accept: ({ version }) => {
						accept(version);
						if (acceptFails) throw new Error("disk full");
						sdk.context.set("termsAccepted", true);
						terms.setState({ version, accepted: true, acceptedAt: 1 });
						return terms.state;
					},
				},
			});
			sdk.context.set("termsAccepted", termsAccepted);
		},
	};
	return { main, methods, accept, setAccount: (state: AccountState) => setAccount(state) };
}

/** kilo.shell's manifest plus a sidebar notice that hosts `SidebarAccount`, as the frame does. */
const shellWithSidebarAccount = {
	...shellManifest,
	contributes: {
		...shellManifest.contributes,
		extensions: {
			...shellManifest.contributes.extensions,
			"kilo.shell/sidebar-notice": [{ id: "test-sidebar-account" }],
		},
	},
};

function HostedSidebarAccount() {
	return (
		<SidebarProvider>
			<div data-qa-id="test-sidebar">
				<SidebarAccount />
			</div>
		</SidebarProvider>
	);
}

const booted: PluginHost[] = [];

/** Stops every host booted by the test; call from `afterEach`. */
export async function disposeHosts(): Promise<void> {
	await Promise.all(booted.splice(0).map((host) => host.dispose()));
}

/** Boots kilo.shell's account area with a fake kilo.core, Navigation, OS and clipboard. */
export async function bootAccount(
	options: {
		account?: AccountState;
		termsAccepted?: boolean;
		/** The terms can't be saved. */
		acceptFails?: boolean;
		/** False for browser mode; defaults to the desktop app. */
		desktop?: boolean;
		guests?: readonly HostedPlugin[];
	} = {},
) {
	const core = fakeCore(
		options.account ?? SIGNED_OUT,
		options.termsAccepted ?? true,
		options.acceptFails ?? false,
	);
	const openSettings = vi.fn();
	const shellMain: PluginEntry = {
		activate(sdk) {
			sdk.domainObjects.provide(Navigation, {
				initialState: { windows: {} },
				methods: {
					navigate: () => {},
					openSettings: (input) => {
						openSettings(input);
					},
					goHome: () => {},
					openDialog: () => {},
					openTakeover: () => {},
					closeTakeover: () => {},
					reportLocation: () => {},
				},
			});
		},
	};
	const shellWeb: PluginEntry = {
		activate(sdk) {
			activateAccount(sdk);
			sdk.extensions.implement(SidebarNotice, "test-sidebar-account", HostedSidebarAccount);
		},
	};
	const host = await createPluginHost(
		[
			{ manifest: coreManifest, definitions: CORE_DEFINITIONS, main: core.main },
			{
				manifest: shellWithSidebarAccount,
				definitions: SHELL_DEFINITIONS,
				main: shellMain,
				web: shellWeb,
			},
			...(options.guests ?? []),
		],
		{ host: { desktop: options.desktop ?? true } },
	);
	booted.push(host);
	const openExternal = vi.fn(() => true);
	const writeText = vi.fn();
	host.main.kernelSdk.domainObjects.provide(KernelOs, {
		initialState: {},
		methods: {
			openExternal,
			showItemInFolder: () => {},
			showLogs: () => ({ revealed: true }),
			logFilePath: () => "/logs/main.log",
		},
	});
	host.main.kernelSdk.domainObjects.provide(KernelClipboard, {
		initialState: {},
		methods: { writeText },
	});
	return { ...core, host, openSettings, openExternal, writeText };
}

/**
 * Draws an onboarding step the way the onboarding host does: heading, body,
 * aside and the footer's primary/Skip actions, inside a dialog.
 */
const stepViews = new WeakMap<OnboardingStepImplementation, ComponentType<StepViewProps>>();

interface StepViewProps {
	readonly next: () => void;
}

function stepView(step: OnboardingStepImplementation): ComponentType<StepViewProps> {
	let View = stepViews.get(step);
	if (!View) {
		View = function StepView({ next }: StepViewProps) {
			const view = step.useStep({ next });
			return (
				<Dialog open>
					<DialogContent>
						{view.title ? <h2>{view.title}</h2> : null}
						{view.subtitle ? <p>{view.subtitle}</p> : null}
						<div data-qa-id="step-body">{view.body}</div>
						{view.aside}
						{view.primary ? (
							<button
								type="button"
								disabled={view.primary.disabled || view.busy}
								onClick={view.primary.onClick}
								data-qa-id="onboarding-continue"
							>
								{view.primary.label}
							</button>
						) : null}
						{view.skippable ? (
							<button type="button" data-qa-id="onboarding-skip">
								Skip
							</button>
						) : null}
						{view.busy ? <span data-qa-id="step-busy" /> : null}
					</DialogContent>
				</Dialog>
			);
		};
		stepViews.set(step, View);
	}
	return View;
}

/** Renders one of the area's onboarding steps (`welcome`, `sign-in`). */
export function renderOnboardingStep(
	host: PluginHost,
	step: "welcome" | "sign-in",
	next: () => void,
) {
	const target = step === "welcome" ? welcomeStep : signInStep;
	return host.renderSlot(
		OnboardingStep,
		{ next },
		{ select: (implementation) => (implementation === target ? stepView(target) : undefined) },
	);
}
