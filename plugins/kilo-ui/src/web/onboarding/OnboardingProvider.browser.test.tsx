import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import type { AuthSession } from "@kilo-desktop/feature-sdk";

import {
	KILO_TERMS_VERSION,
	ONBOARDING_VERSION,
	onboardingContract,
	type OnboardingState,
	type TermsAcceptance,
} from "../../contracts/onboarding/schemas.js";
import type { KiloGlobalConnection } from "../../contracts/chat/schemas.js";
import { ChatConnectionProvider } from "../chat/connection/ChatConnectionContext.js";
import { workspacesContract, type Workspace } from "../../contracts/workspaces/schemas.js";
import { KiloAuthContext, type KiloAuthContextValue } from "../account/KiloAuthContext.js";
import {
	WorkspacesContext,
	type WorkspacesContextValue,
} from "../workspaces/WorkspacesFeatureContext.js";

import { OnboardingProvider } from "./OnboardingProvider.js";
import { FORCE_ONBOARDING_FLAG } from "./resolve-onboarding.js";
import { REVIEW_FIRST_PERMISSION } from "./work-style-presets.js";

/** In-memory stand-in for the user's global Kilo config (`~/.config/kilo/kilo.jsonc`). */
const kilo = vi.hoisted(() => ({
	permission: undefined as Record<string, unknown> | undefined,
	updateError: null as Error | null,
	updates: [] as Array<{ permission: Record<string, unknown> }>,
	dispose: vi.fn(),
}));

vi.mock("../chat/runtime/create-kilo-runtime-client.js", () => ({
	createKiloDirectoryClient: vi.fn(() => ({
		global: {
			dispose: async () => kilo.dispose(),
			config: {
				get: async () => ({ data: kilo.permission ? { permission: kilo.permission } : {} }),
				update: async ({ config }: { config: { permission: Record<string, unknown> } }) => {
					if (kilo.updateError) throw kilo.updateError;
					kilo.updates.push(config);
					// Kilo's updateGlobal merge: null deletes, scalars replace, pattern maps
					// merge per pattern (a scalar is promoted to { "*": scalar } first).
					const next: Record<string, unknown> = { ...kilo.permission };
					for (const [key, rule] of Object.entries(config.permission)) {
						if (rule === null) {
							delete next[key];
						} else if (typeof rule === "string") {
							next[key] = rule;
						} else {
							const existing = next[key];
							const merged: Record<string, unknown> =
								typeof existing === "string"
									? { "*": existing }
									: { ...(existing as Record<string, unknown> | undefined) };
							for (const [pattern, action] of Object.entries(rule as Record<string, unknown>)) {
								if (action === null) delete merged[pattern];
								else merged[pattern] = action;
							}
							next[key] = merged;
						}
					}
					kilo.permission = Object.keys(next).length > 0 ? next : undefined;
					return { data: {} };
				},
			},
		},
	})),
}));

const connection: KiloGlobalConnection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password: "secret",
	version: "7.4.20",
	globalDirectory: "/tmp/kilo-runtime",
};

// Every step change runs a mode="wait" exit + enter animation that Playwright
// must wait out before acting. On the contended CI coverage runner that pushed
// multi-step walks past the 15s browser test timeout, so settle them instantly.
beforeAll(() => {
	MotionGlobalConfig.skipAnimations = true;
});

afterAll(() => {
	MotionGlobalConfig.skipAnimations = false;
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	kilo.permission = undefined;
	kilo.updateError = null;
	kilo.updates = [];
});

const createdWorkspace: Workspace = {
	id: "ws-1",
	name: "Alpha",
	folders: [{ id: "f-1", path: "/projects/alpha", isPrimary: true, position: 0 }],
	createdAt: 1,
	updatedAt: 1,
};

const acceptedTerms: TermsAcceptance = {
	version: KILO_TERMS_VERSION,
	acceptedAt: 1,
	linkedAccounts: [],
};

function idleAuth(overrides: Partial<KiloAuthContextValue> = {}): KiloAuthContextValue {
	return {
		isLoading: false,
		connectionUnavailable: false,
		authenticated: false,
		profile: null,
		deviceAuth: { status: "idle" },
		isRefreshing: false,
		isSwitchingOrg: false,
		profileError: null,
		orgError: null,
		login: vi.fn(),
		cancelLogin: vi.fn(),
		logout: vi.fn(),
		refreshProfile: vi.fn(),
		setOrganization: vi.fn(),
		dismissOrgError: vi.fn(),
		openExternal: vi.fn(),
		...overrides,
	};
}

function workspacesValue(overrides: Partial<WorkspacesContextValue> = {}): WorkspacesContextValue {
	return {
		workspaces: [],
		activeWorkspaceId: null,
		setActiveWorkspaceId: vi.fn(),
		isLoading: false,
		isUnavailable: false,
		openCreate: vi.fn(),
		openEdit: vi.fn(),
		openDelete: vi.fn(),
		...overrides,
	};
}

function renderOnboarding(options: {
	auth?: Partial<KiloAuthContextValue>;
	workspaces?: Partial<WorkspacesContextValue>;
	onboarding?: OnboardingState;
	create?: () => Promise<Workspace>;
	complete?: () => Promise<OnboardingState>;
	get?: () => Promise<OnboardingState>;
	flags?: Record<string, unknown>;
	session?: AuthSession;
	terms?: TermsAcceptance | null;
	getTerms?: () => Promise<TermsAcceptance | null>;
	/** Runs before the fake records an acceptance; throw to fail the write. */
	beforeAcceptTerms?: () => Promise<void>;
}) {
	let onboarding: OnboardingState = options.onboarding ?? {
		outcome: null,
		closedAt: null,
		version: null,
	};
	let terms: TermsAcceptance | null = options.terms ?? null;
	const session: AuthSession = options.session ?? { status: "anonymous" };
	const track = vi.fn(async () => {});
	const withAccount = (acceptance: TermsAcceptance, key: string | undefined) =>
		key === undefined || acceptance.linkedAccounts.includes(key)
			? acceptance
			: { ...acceptance, linkedAccounts: [...acceptance.linkedAccounts, key] };
	const setActiveWorkspaceId = vi.fn();
	const flags = options.flags ?? {};
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		telemetry: { track },
		auth: {
			peek: () => session,
			subscribe: (fn) => {
				fn(session);
				return () => {};
			},
		},
		featureFlags: {
			peek: () => flags,
			subscribe: (fn) => {
				fn(flags);
				return () => {};
			},
		},
		channels: { ...onboardingContract, ...workspacesContract },
		shell: {
			canPickDirectories: true,
			showOpenDialog: async () => ({ canceled: false, paths: ["/projects/alpha"] }),
		},
		handlers: {
			"onboarding.get": options.get ?? (async () => onboarding),
			"onboarding.complete":
				options.complete ??
				(async () => {
					onboarding = { outcome: "completed", closedAt: Date.now(), version: ONBOARDING_VERSION };
					return onboarding;
				}),
			"onboarding.skip": async () => {
				onboarding = { outcome: "skipped", closedAt: Date.now(), version: ONBOARDING_VERSION };
				return onboarding;
			},
			"onboarding.terms.get": options.getTerms ?? (async () => terms),
			"onboarding.terms.accept": async ({
				version,
				accountKey,
			}: {
				version: string;
				accountKey?: string | undefined;
			}) => {
				await options.beforeAcceptTerms?.();
				const base: TermsAcceptance =
					terms?.version === version
						? terms
						: { version, acceptedAt: Date.now(), linkedAccounts: [] };
				terms = withAccount(base, accountKey);
				return terms;
			},
			"onboarding.terms.markLinked": async ({ accountKey }: { accountKey: string }) => {
				if (terms) terms = withAccount(terms, accountKey);
				return terms;
			},
			list: async () => options.workspaces?.workspaces ?? [],
			get: async () => null,
			create: options.create ?? (async () => createdWorkspace),
			update: async () => createdWorkspace,
			remove: async () => ({ deleted: true }),
		},
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesContext.Provider
					value={workspacesValue({
						setActiveWorkspaceId,
						...options.workspaces,
					})}
				>
					<ChatConnectionProvider
						status={{
							isPending: false,
							isError: false,
							error: null,
							connection,
							connectionPromise: Promise.resolve(connection),
						}}
					>
						<KiloAuthContext.Provider value={idleAuth(options.auth)}>
							<OnboardingProvider>
								<div data-qa-id="app-body">App</div>
							</OnboardingProvider>
						</KiloAuthContext.Provider>
					</ChatConnectionProvider>
				</WorkspacesContext.Provider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { screen: page.elementLocator(baseElement), setActiveWorkspaceId, sdk, track };
}

type Screen = ReturnType<typeof renderOnboarding>["screen"];

async function continueFromWelcome(screen: Screen) {
	await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();
	await screen.getByTestId("onboarding-accept-terms").click();
	await screen.getByTestId("onboarding-get-started").click();
	await expect.element(screen.getByTestId("onboarding-welcome")).not.toBeInTheDocument();
}

/** Continues past the work-style step on its pre-selected High autonomy (writes nothing). */
async function skipWorkStyle(screen: Screen) {
	await expect
		.element(screen.getByRole("heading", { name: "Choose how you want to work" }))
		.toBeVisible();
	await screen.getByTestId("onboarding-continue").click();
}

async function createWorkspaceFromSignIn(screen: Screen) {
	await screen.getByTestId("onboarding-continue").click();
	await skipWorkStyle(screen);
	await expect.element(screen.getByRole("heading", { name: "Create a workspace" })).toBeVisible();
	await screen.getByRole("button", { name: /Drop folders/ }).click();
	await expect
		.element(screen.getByTestId("onboarding-step-body").getByText("alpha", { exact: true }))
		.toBeVisible();
	await screen.getByTestId("onboarding-continue").click();
}

async function reachWorkStyle(screen: Screen) {
	await continueFromWelcome(screen);
	await screen.getByTestId("onboarding-continue").click();
	await expect
		.element(screen.getByRole("heading", { name: "Choose how you want to work" }))
		.toBeVisible();
}

function trackedEvents(track: ReturnType<typeof renderOnboarding>["track"]) {
	return (
		track.mock.calls as unknown as Array<[{ event: string; data: Record<string, unknown> }]>
	).map(([input]) => {
		const { featureId: _featureId, ...data } = input.data;
		return { event: input.event, data };
	});
}

function trackedWorkStyle(track: ReturnType<typeof renderOnboarding>["track"]) {
	return trackedEvents(track).filter(({ event }) => event.startsWith("Work Style"));
}

function trackedTerms(track: ReturnType<typeof renderOnboarding>["track"]) {
	return trackedEvents(track).filter(({ event }) => event.startsWith("Terms "));
}

function trackedLifecycle(track: ReturnType<typeof renderOnboarding>["track"]) {
	return trackedEvents(track).filter(({ event }) =>
		["Onboarding Shown", "Onboarding Completed", "Onboarding Skipped"].includes(event),
	);
}

describe("OnboardingProvider", () => {
	it("opens on the welcome splash, then shows sign-in for a fresh user", async () => {
		const { screen } = renderOnboarding({});

		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();
		await expect.element(screen.getByTestId("app-body")).toBeVisible();
		await continueFromWelcome(screen);

		await expect.element(screen.getByRole("heading", { name: "Sign in to Kilo" })).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-login")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-skip")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-continue")).not.toBeInTheDocument();

		await screen.getByTestId("onboarding-back").click();
		await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();
	});

	it("keeps Get started disabled until the terms are accepted, and remembers acceptance", async () => {
		const { screen } = renderOnboarding({});

		const getStarted = screen.getByTestId("onboarding-get-started");
		const terms = screen.getByRole("checkbox", { name: /I agree to the terms of service/ });
		await expect.element(getStarted).toBeDisabled();
		await expect.element(terms).not.toBeChecked();
		await expect
			.element(screen.getByTestId("onboarding-terms-link"))
			.toHaveAttribute("href", "https://kilo.ai/terms");

		await terms.click();
		await expect.element(getStarted).toBeEnabled();
		await terms.click();
		await expect.element(getStarted).toBeDisabled();

		await terms.click();
		await getStarted.click();
		await expect.element(screen.getByRole("heading", { name: "Sign in to Kilo" })).toBeVisible();
		await screen.getByTestId("onboarding-back").click();
		await expect.element(terms).toBeChecked();
		await expect.element(getStarted).toBeEnabled();
	});

	it("records terms acceptance and reports it anonymously when signed out", async () => {
		const { screen, sdk, track } = renderOnboarding({});

		await continueFromWelcome(screen);

		await expect
			.poll(() => sdk.invoke("onboarding.terms.get"))
			.toMatchObject({ version: KILO_TERMS_VERSION, linkedAccounts: [] });
		await expect.poll(() => trackedTerms(track).length).toBe(1);
		expect(track).toHaveBeenCalledWith({
			event: "Terms Accepted",
			data: expect.objectContaining({
				termsVersion: KILO_TERMS_VERSION,
				$set_once: expect.objectContaining({ terms_version: KILO_TERMS_VERSION }),
			}),
		});
		expect(trackedLifecycle(track)).toEqual([{ event: "Onboarding Shown", data: {} }]);
	});

	it("links an earlier acceptance to the account once it signs in, only once", async () => {
		const accepted: TermsAcceptance = {
			version: KILO_TERMS_VERSION,
			acceptedAt: Date.UTC(2026, 8, 29),
			linkedAccounts: [],
		};
		const session: AuthSession = {
			status: "authenticated",
			user: { email: "Ada@Example.com" },
		};
		const first = renderOnboarding({
			onboarding: { outcome: "completed", closedAt: 1, version: ONBOARDING_VERSION },
			terms: accepted,
			session,
		});

		await expect.poll(() => first.track.mock.calls.length).toBe(1);
		expect(first.track).toHaveBeenCalledWith({
			event: "Terms Acceptance Linked",
			data: expect.objectContaining({
				$set_once: {
					terms_accepted_at: "2026-09-29T00:00:00.000Z",
					terms_version: KILO_TERMS_VERSION,
				},
			}),
		});
		const linked = (await first.sdk.invoke("onboarding.terms.get")) as TermsAcceptance;
		expect(linked.linkedAccounts).toHaveLength(1);
		expect(linked.linkedAccounts[0]).toMatch(/^[0-9a-f]{64}$/);
		cleanup();

		const again = renderOnboarding({
			onboarding: { outcome: "completed", closedAt: 1, version: ONBOARDING_VERSION },
			terms: linked,
			session,
		});
		await expect.element(again.screen.getByTestId("app-body")).toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(again.track).not.toHaveBeenCalled();
	});

	it("attributes acceptance directly when already signed in", async () => {
		const { screen, sdk, track } = renderOnboarding({
			session: { status: "authenticated", user: { userId: "user-1", email: "ada@example.com" } },
		});

		await continueFromWelcome(screen);

		await expect
			.poll(() => sdk.invoke("onboarding.terms.get"))
			.toMatchObject({ linkedAccounts: [expect.any(String)] });
		await expect.poll(() => trackedTerms(track).length).toBe(1);
		expect(track).toHaveBeenCalledWith(expect.objectContaining({ event: "Terms Accepted" }));
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(trackedTerms(track)).toHaveLength(1);
	});

	it("does not link anything for a signed-in user who never accepted", async () => {
		const { screen, track } = renderOnboarding({
			onboarding: { outcome: "skipped", closedAt: 1, version: ONBOARDING_VERSION },
			session: { status: "authenticated", user: { email: "ada@example.com" } },
		});

		await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(track).not.toHaveBeenCalled();
	});

	it("keeps the welcome step open on Escape until the terms are accepted", async () => {
		const { screen, sdk, track } = renderOnboarding({});

		await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();
		await userEvent.keyboard("{Escape}");
		await new Promise((resolve) => setTimeout(resolve, 100));

		await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();
		expect(await sdk.invoke("onboarding.get")).toMatchObject({ outcome: null });
		expect(trackedLifecycle(track)).toEqual([{ event: "Onboarding Shown", data: {} }]);
	});

	it("gates a user who skipped onboarding without accepting the terms, then lets them in", async () => {
		const { screen, sdk, track } = renderOnboarding({
			onboarding: { outcome: "skipped", closedAt: 1, version: ONBOARDING_VERSION },
		});

		await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();
		await userEvent.keyboard("{Escape}");
		await new Promise((resolve) => setTimeout(resolve, 100));
		await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();

		await screen.getByTestId("onboarding-accept-terms").click();
		await screen.getByTestId("onboarding-get-started").click();

		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("app-body")).toBeVisible();
		expect(await sdk.invoke("onboarding.terms.get")).toMatchObject({
			version: KILO_TERMS_VERSION,
		});
		expect(await sdk.invoke("onboarding.get")).toMatchObject({ outcome: "skipped" });
		expect(trackedLifecycle(track)).toEqual([]);
		await expect
			.poll(() => trackedTerms(track).map(({ event }) => event))
			.toEqual(["Terms Accepted"]);
	});

	it("gates again when the terms version changes", async () => {
		const { screen } = renderOnboarding({
			onboarding: { outcome: "completed", closedAt: 1, version: ONBOARDING_VERSION },
			terms: { version: "2020-01-01", acceptedAt: 1, linkedAccounts: [] },
		});

		await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();
	});

	it("stays on the welcome step when recording the acceptance fails, and retries", async () => {
		let failAccept = true;
		const { screen } = renderOnboarding({
			beforeAcceptTerms: async () => {
				if (failAccept) throw new Error("kv write failed");
			},
		});

		await screen.getByTestId("onboarding-accept-terms").click();
		await screen.getByTestId("onboarding-get-started").click();

		await expect.element(screen.getByTestId("onboarding-terms-error")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();

		failAccept = false;
		await screen.getByTestId("onboarding-get-started").click();
		await expect.element(screen.getByRole("heading", { name: "Sign in to Kilo" })).toBeVisible();
	});

	it("gates the app when the terms record cannot be read", async () => {
		const { screen } = renderOnboarding({
			onboarding: { outcome: "completed", closedAt: 1, version: ONBOARDING_VERSION },
			getTerms: async () => {
				throw new Error("kv unavailable");
			},
		});

		await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();
	});

	it("keeps the app covered while the terms record is loading", async () => {
		const { screen } = renderOnboarding({
			onboarding: { outcome: "completed", closedAt: 1, version: ONBOARDING_VERSION },
			getTerms: () => new Promise<TermsAcceptance | null>(() => undefined),
		});

		await expect.element(screen.getByTestId("onboarding-pending")).toBeInTheDocument();
		await new Promise((resolve) => setTimeout(resolve, 100));
		await expect.element(screen.getByTestId("onboarding-pending")).toBeInTheDocument();
	});

	it("gates the app when Kilo is unavailable and the terms are not accepted", async () => {
		const { screen } = renderOnboarding({
			auth: { connectionUnavailable: true },
		});

		await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();
		await screen.getByTestId("onboarding-accept-terms").click();
		await screen.getByTestId("onboarding-get-started").click();

		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("app-body")).toBeVisible();
	});

	it("advances through sign-in and workspace with Skip, then completes on the features slide", async () => {
		const { screen, sdk, setActiveWorkspaceId, track } = renderOnboarding({});

		await continueFromWelcome(screen);
		await expect.element(screen.getByRole("heading", { name: "Sign in to Kilo" })).toBeVisible();
		await screen.getByTestId("onboarding-skip").click();
		await skipWorkStyle(screen);

		await expect.element(screen.getByRole("heading", { name: "Create a workspace" })).toBeVisible();
		await screen.getByTestId("onboarding-skip").click();

		await expect.element(screen.getByTestId("onboarding-features")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-skip")).not.toBeInTheDocument();
		await screen.getByTestId("onboarding-back").click();
		await expect.element(screen.getByRole("heading", { name: "Create a workspace" })).toBeVisible();
		await screen.getByTestId("onboarding-skip").click();

		await screen.getByTestId("onboarding-continue").click();
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
		await expect.poll(() => sdk.invoke("onboarding.get")).toMatchObject({ outcome: "completed" });
		expect(setActiveWorkspaceId).not.toHaveBeenCalled();
		expect(trackedLifecycle(track)).toEqual([
			{ event: "Onboarding Shown", data: {} },
			{ event: "Onboarding Completed", data: {} },
		]);
	});

	it("shows the wizard even when the user already has a workspace", async () => {
		const { screen } = renderOnboarding({
			workspaces: { workspaces: [createdWorkspace] },
		});

		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();
		await expect.element(screen.getByTestId("app-body")).toBeVisible();
	});

	it("skips the workspace step for users who already have a workspace", async () => {
		const { screen, sdk, setActiveWorkspaceId } = renderOnboarding({
			auth: { authenticated: true },
			workspaces: { workspaces: [createdWorkspace] },
		});

		await reachWorkStyle(screen);
		await expect
			.element(screen.getByTestId("onboarding-progress-label"))
			.toHaveTextContent("Step 2 of 3");
		await expect
			.element(screen.getByTestId("onboarding-progress-workspace"))
			.not.toBeInTheDocument();

		await screen.getByTestId("onboarding-continue").click();
		await expect.element(screen.getByTestId("onboarding-features")).toBeVisible();
		await expect
			.element(screen.getByTestId("onboarding-progress-label"))
			.toHaveTextContent("Step 3 of 3");

		await screen.getByTestId("onboarding-back").click();
		await expect
			.element(screen.getByRole("heading", { name: "Choose how you want to work" }))
			.toBeVisible();
		await screen.getByTestId("onboarding-continue").click();

		await screen.getByTestId("onboarding-continue").click();
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
		await expect.poll(() => sdk.invoke("onboarding.get")).toMatchObject({ outcome: "completed" });
		expect(setActiveWorkspaceId).not.toHaveBeenCalled();
	});

	it("hides the wizard when onboarding was previously completed", async () => {
		const { screen } = renderOnboarding({
			onboarding: { outcome: "completed", closedAt: 1, version: ONBOARDING_VERSION },
			terms: acceptedTerms,
			workspaces: { workspaces: [createdWorkspace] },
		});

		await expect.element(screen.getByTestId("app-body")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
	});

	it("hides the wizard when onboarding was previously skipped", async () => {
		const { screen } = renderOnboarding({
			onboarding: { outcome: "skipped", closedAt: 1, version: ONBOARDING_VERSION },
			terms: acceptedTerms,
			workspaces: { workspaces: [createdWorkspace] },
		});

		await expect.element(screen.getByTestId("app-body")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
	});

	it("shows the overlay while Kilo auth is still resolving", async () => {
		const { screen } = renderOnboarding({
			auth: { authenticated: null },
		});

		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();
		await continueFromWelcome(screen);
		await expect.element(screen.getByTestId("onboarding-connecting")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-skip")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-continue")).not.toBeInTheDocument();
	});

	it("shows the wizard when the workspace list cannot be read", async () => {
		const { screen } = renderOnboarding({
			workspaces: { isUnavailable: true },
		});

		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();
		await expect.element(screen.getByTestId("app-body")).toBeVisible();
	});

	it("never shows the app uncovered while deciding to onboard a fresh user", async () => {
		let resolveGet: (state: OnboardingState) => void = () => undefined;
		const { screen } = renderOnboarding({
			get: () => new Promise<OnboardingState>((resolve) => (resolveGet = resolve)),
		});

		await expect.element(screen.getByTestId("onboarding-pending")).toBeInTheDocument();
		expect(document.querySelector('[data-qa-id="app-body"]')).not.toBeNull();

		let uncoveredFrames = 0;
		let sampling = true;
		const sample = () => {
			const covered =
				document.querySelector('[data-qa-id="onboarding-pending"]') !== null ||
				document.querySelector('[data-qa-id="onboarding-overlay"]') !== null;
			if (!covered) uncoveredFrames++;
			if (sampling) requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);

		resolveGet({ outcome: null, closedAt: null, version: null });
		await expect.element(screen.getByTestId("onboarding-welcome")).toBeVisible();
		sampling = false;

		expect(uncoveredFrames).toBe(0);
		await expect.element(screen.getByTestId("onboarding-pending")).not.toBeInTheDocument();
	});

	it("shows the redesigned wizard once to users who finished the previous onboarding", async () => {
		const { screen, sdk } = renderOnboarding({
			onboarding: { outcome: "completed", closedAt: 1, version: null },
		});

		await continueFromWelcome(screen);
		await expect.element(screen.getByRole("heading", { name: "Sign in to Kilo" })).toBeVisible();
		await userEvent.keyboard("{Escape}");

		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
		await expect
			.poll(() => sdk.invoke("onboarding.get"))
			.toMatchObject({ outcome: "skipped", version: ONBOARDING_VERSION });
	});

	it("lifts the cover for a returning user without showing the wizard", async () => {
		const { screen } = renderOnboarding({
			onboarding: { outcome: "completed", closedAt: 1, version: ONBOARDING_VERSION },
			terms: acceptedTerms,
		});

		await expect.element(screen.getByTestId("app-body")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-pending")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
	});

	it("hides the wizard for an accepted user when persisted onboarding state cannot be read", async () => {
		const { screen } = renderOnboarding({
			terms: acceptedTerms,
			get: async () => {
				throw new Error("kv unavailable");
			},
		});

		await expect.element(screen.getByTestId("app-body")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("onboarding-pending")).not.toBeInTheDocument();
	});

	it("hides the wizard for an accepted user when Kilo is unavailable", async () => {
		const { screen } = renderOnboarding({
			terms: acceptedTerms,
			auth: { connectionUnavailable: true },
		});

		await expect.element(screen.getByTestId("app-body")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
	});

	it("walks sign-in and workspace creation, then shows the features slide", async () => {
		const { screen, setActiveWorkspaceId, sdk } = renderOnboarding({
			auth: { authenticated: true },
		});

		await continueFromWelcome(screen);
		await expect.element(screen.getByTestId("onboarding-signed-in")).toBeVisible();
		await expect.element(screen.getByRole("heading", { name: "Signed in to Kilo" })).toBeVisible();
		await expect
			.element(screen.getByTestId("onboarding-progress-label"))
			.toHaveTextContent("Step 1 of 4");
		await expect.element(screen.getByTestId("onboarding-skip")).not.toBeInTheDocument();

		await createWorkspaceFromSignIn(screen);

		await expect.element(screen.getByTestId("onboarding-features")).toBeVisible();
		expect(setActiveWorkspaceId).toHaveBeenCalledWith(createdWorkspace.id);
		await expect.poll(() => sdk.invoke("onboarding.get")).toMatchObject({ outcome: "completed" });
		await expect.element(screen.getByTestId("onboarding-back")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("onboarding-skip")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("onboarding-progress-workspace")).toBeDisabled();

		await screen.getByTestId("onboarding-continue").click();
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
	});

	it("saves completion before moving from a created workspace to the features slide", async () => {
		let finishComplete: () => void = () => undefined;
		const { screen, setActiveWorkspaceId } = renderOnboarding({
			auth: { authenticated: true },
			complete: () =>
				new Promise<OnboardingState>((resolve) => {
					finishComplete = () =>
						resolve({ outcome: "completed", closedAt: Date.now(), version: ONBOARDING_VERSION });
				}),
		});

		await continueFromWelcome(screen);
		await createWorkspaceFromSignIn(screen);

		await expect.poll(() => setActiveWorkspaceId.mock.calls.length).toBe(1);
		await new Promise(requestAnimationFrame);
		await new Promise(requestAnimationFrame);
		const overlay = document.querySelector<HTMLElement>('[data-qa-id="onboarding-overlay"]');
		expect(overlay?.dataset.step).toBe("workspace");
		await expect.element(screen.getByTestId("onboarding-continue")).toHaveTextContent("Creating…");

		finishComplete();
		await expect.element(screen.getByTestId("onboarding-features")).toBeVisible();
		await expect
			.element(screen.getByTestId("onboarding-continue"))
			.toHaveTextContent("Start building");
		await expect.element(screen.getByTestId("onboarding-continue")).toBeEnabled();
	});

	it("does not report a workspace save error when only onboarding complete fails", async () => {
		const { screen, setActiveWorkspaceId } = renderOnboarding({
			auth: { authenticated: true },
			complete: async () => {
				throw new Error("kv write failed");
			},
		});

		await continueFromWelcome(screen);
		await createWorkspaceFromSignIn(screen);

		await expect.element(screen.getByTestId("onboarding-features")).toBeVisible();
		expect(setActiveWorkspaceId).toHaveBeenCalledWith(createdWorkspace.id);
		await expect.element(screen.getByText("Could not save workspace.")).not.toBeInTheDocument();
	});

	it("reopens a previously skipped wizard when force-onboarding is on", async () => {
		const { screen } = renderOnboarding({
			onboarding: { outcome: "skipped", closedAt: 1, version: ONBOARDING_VERSION },
			terms: acceptedTerms,
			flags: { [FORCE_ONBOARDING_FLAG]: true },
		});

		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();

		await continueFromWelcome(screen);
		await userEvent.keyboard("{Escape}");
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
	});

	it("closes a forced wizard once the user finishes the features slide", async () => {
		const { screen } = renderOnboarding({
			auth: { authenticated: true },
			onboarding: { outcome: "completed", closedAt: 1, version: ONBOARDING_VERSION },
			flags: { [FORCE_ONBOARDING_FLAG]: true },
		});

		await continueFromWelcome(screen);
		await createWorkspaceFromSignIn(screen);
		await expect.element(screen.getByTestId("onboarding-features")).toBeVisible();
		await screen.getByTestId("onboarding-continue").click();

		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
	});
	describe("work-style step", () => {
		it("is step 2 of 4 with High autonomy pre-selected and nothing written yet", async () => {
			const { screen } = renderOnboarding({ auth: { authenticated: true } });
			await reachWorkStyle(screen);

			await expect
				.element(screen.getByTestId("onboarding-progress-label"))
				.toHaveTextContent("Step 2 of 4");
			await expect.element(screen.getByRole("radiogroup", { name: "Work style" })).toBeVisible();
			await expect.element(screen.getByRole("radio", { name: /High autonomy/ })).toBeChecked();
			await expect.element(screen.getByRole("radio", { name: /Review first/ })).not.toBeChecked();
			await expect.element(screen.getByTestId("onboarding-continue")).toBeEnabled();
			expect(kilo.updates).toEqual([]);
			await expect.element(screen.getByTestId("onboarding-progress-workspace")).toBeDisabled();
			await expect
				.element(screen.getByTestId("onboarding-work-style-existing"))
				.not.toBeInTheDocument();
		});

		it("writes the review-first block to the global config, then moves to the workspace step", async () => {
			const { screen, track } = renderOnboarding({ auth: { authenticated: true } });
			await reachWorkStyle(screen);

			await screen.getByTestId("onboarding-work-style-human-in-the-loop").click();
			await screen.getByTestId("onboarding-continue").click();

			await expect
				.element(screen.getByRole("heading", { name: "Create a workspace" }))
				.toBeVisible();
			expect(kilo.updates).toEqual([{ permission: REVIEW_FIRST_PERMISSION }]);
			expect(kilo.dispose).toHaveBeenCalledOnce();
			expect(trackedWorkStyle(track)).toEqual([
				{ event: "Work Style Onboarding Shown", data: {} },
				{ event: "Work Style Selected", data: { style: "human-in-the-loop" } },
			]);
		});

		it("writes nothing for high autonomy", async () => {
			const { screen, track } = renderOnboarding({ auth: { authenticated: true } });
			await reachWorkStyle(screen);

			await screen.getByTestId("onboarding-work-style-autonomous").click();
			await screen.getByTestId("onboarding-continue").click();

			await expect
				.element(screen.getByRole("heading", { name: "Create a workspace" }))
				.toBeVisible();
			expect(kilo.updates).toEqual([]);
			expect(kilo.dispose).not.toHaveBeenCalled();
			expect(trackedWorkStyle(track).at(-1)).toEqual({
				event: "Work Style Selected",
				data: { style: "autonomous" },
			});
		});

		it("offers no Skip: continuing on High autonomy is the way through without writing", async () => {
			const { screen } = renderOnboarding({ auth: { authenticated: true } });
			await reachWorkStyle(screen);

			await expect.element(screen.getByTestId("onboarding-skip")).not.toBeInTheDocument();
			await expect.element(screen.getByTestId("onboarding-back")).toBeVisible();
		});

		it("overrides existing machine rules for the preset keys and warns first", async () => {
			kilo.permission = { bash: "allow", edit: "allow", mcp_tool: { "*": "allow" } };
			const { screen } = renderOnboarding({ auth: { authenticated: true } });
			await reachWorkStyle(screen);

			await expect
				.element(screen.getByTestId("onboarding-work-style-existing"))
				.not.toBeInTheDocument();
			await screen.getByTestId("onboarding-work-style-human-in-the-loop").click();
			await expect
				.element(screen.getByTestId("onboarding-work-style-existing"))
				.toHaveTextContent(
					"This replaces the matching permission rules already in your Kilo config.",
				);
			await screen.getByTestId("onboarding-continue").click();

			await expect
				.element(screen.getByRole("heading", { name: "Create a workspace" }))
				.toBeVisible();
			expect(kilo.permission).toEqual({ ...REVIEW_FIRST_PERMISSION, mcp_tool: { "*": "allow" } });
		});

		it("restores the replaced machine rules when the user goes Back and switches", async () => {
			const machine = { bash: "allow", external_directory: { "/Users/me/*": "allow" } };
			kilo.permission = structuredClone(machine);
			const { screen } = renderOnboarding({ auth: { authenticated: true } });
			await reachWorkStyle(screen);
			await screen.getByTestId("onboarding-work-style-human-in-the-loop").click();
			await screen.getByTestId("onboarding-continue").click();
			await expect
				.element(screen.getByRole("heading", { name: "Create a workspace" }))
				.toBeVisible();
			expect(kilo.permission).toEqual(REVIEW_FIRST_PERMISSION);

			await screen.getByTestId("onboarding-back").click();
			await expect
				.element(screen.getByTestId("onboarding-work-style-existing"))
				.not.toBeInTheDocument();
			await screen.getByTestId("onboarding-work-style-autonomous").click();
			await screen.getByTestId("onboarding-continue").click();

			await expect
				.element(screen.getByRole("heading", { name: "Create a workspace" }))
				.toBeVisible();
			expect(kilo.permission).toEqual(machine);
		});

		it("shows a failed write, stays on the step, and succeeds on retry", async () => {
			kilo.updateError = new Error("Could not write kilo.jsonc");
			const { screen } = renderOnboarding({ auth: { authenticated: true } });
			await reachWorkStyle(screen);

			await screen.getByTestId("onboarding-work-style-human-in-the-loop").click();
			await screen.getByTestId("onboarding-continue").click();

			await expect.element(screen.getByText("Could not write kilo.jsonc")).toBeVisible();
			await expect
				.element(screen.getByRole("heading", { name: "Choose how you want to work" }))
				.toBeVisible();
			await expect.element(screen.getByTestId("onboarding-continue")).toHaveTextContent("Retry");

			kilo.updateError = null;
			await screen.getByTestId("onboarding-continue").click();

			await expect
				.element(screen.getByRole("heading", { name: "Create a workspace" }))
				.toBeVisible();
			expect(kilo.updates).toEqual([{ permission: REVIEW_FIRST_PERMISSION }]);
		});

		it("reverts its own write when the user goes Back and switches to high autonomy", async () => {
			const { screen, track } = renderOnboarding({ auth: { authenticated: true } });
			await reachWorkStyle(screen);
			await screen.getByTestId("onboarding-work-style-human-in-the-loop").click();
			await screen.getByTestId("onboarding-continue").click();
			await expect
				.element(screen.getByRole("heading", { name: "Create a workspace" }))
				.toBeVisible();

			await screen.getByTestId("onboarding-back").click();
			await expect
				.element(screen.getByTestId("onboarding-work-style-existing"))
				.not.toBeInTheDocument();
			await screen.getByTestId("onboarding-work-style-autonomous").click();
			await screen.getByTestId("onboarding-continue").click();

			await expect
				.element(screen.getByRole("heading", { name: "Create a workspace" }))
				.toBeVisible();
			expect(kilo.updates).toHaveLength(2);
			expect(Object.values(kilo.updates[1]!.permission).every((rule) => rule === null)).toBe(true);
			expect(kilo.permission).toBeUndefined();
			expect(
				trackedWorkStyle(track).filter(({ event }) => event === "Work Style Onboarding Shown"),
			).toHaveLength(1);
		});

		it("still saves onboarding as skipped when dismissed with Escape", async () => {
			const { screen, sdk, track } = renderOnboarding({ auth: { authenticated: true } });
			await reachWorkStyle(screen);

			await userEvent.keyboard("{Escape}");

			await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
			await expect.poll(() => sdk.invoke("onboarding.get")).toMatchObject({ outcome: "skipped" });
			expect(kilo.updates).toEqual([]);
			expect(trackedLifecycle(track)).toEqual([
				{ event: "Onboarding Shown", data: {} },
				{ event: "Onboarding Skipped", data: {} },
			]);
		});
	});
});
