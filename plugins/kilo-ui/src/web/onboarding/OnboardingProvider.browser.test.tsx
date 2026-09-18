import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@kilo-desktop/testing";

import { onboardingContract, type OnboardingState } from "../../contracts/onboarding/schemas.js";
import { workspacesContract, type Workspace } from "../../contracts/workspaces/schemas.js";
import { KiloAuthContext, type KiloAuthContextValue } from "../account/KiloAuthContext.js";
import {
	WorkspacesContext,
	type WorkspacesContextValue,
} from "../workspaces/WorkspacesFeatureContext.js";

import { OnboardingProvider } from "./OnboardingProvider.js";

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

const createdWorkspace: Workspace = {
	id: "ws-1",
	name: "Alpha",
	folders: [{ id: "f-1", path: "/projects/alpha", isPrimary: true, position: 0 }],
	createdAt: 1,
	updatedAt: 1,
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
}) {
	let onboarding: OnboardingState = options.onboarding ?? { outcome: null, closedAt: null };
	const setActiveWorkspaceId = vi.fn();
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
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
					onboarding = { outcome: "completed", closedAt: Date.now() };
					return onboarding;
				}),
			"onboarding.skip": async () => {
				onboarding = { outcome: "skipped", closedAt: Date.now() };
				return onboarding;
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
					<KiloAuthContext.Provider value={idleAuth(options.auth)}>
						<OnboardingProvider>
							<div data-qa-id="app-body">App</div>
						</OnboardingProvider>
					</KiloAuthContext.Provider>
				</WorkspacesContext.Provider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { screen: page.elementLocator(baseElement), setActiveWorkspaceId, sdk };
}

describe("OnboardingProvider", () => {
	it("shows the sign-in step for a fresh user and skip closes the overlay", async () => {
		const { screen } = renderOnboarding({});

		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-account-login")).toBeVisible();
		await expect.element(screen.getByTestId("app-body")).toBeVisible();

		await screen.getByTestId("onboarding-skip").click();
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
	});

	it("shows the wizard even when the user already has a workspace", async () => {
		const { screen } = renderOnboarding({
			workspaces: { workspaces: [createdWorkspace] },
		});

		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();
		await expect.element(screen.getByTestId("app-body")).toBeVisible();
	});

	it("hides the wizard when onboarding was previously completed", async () => {
		const { screen } = renderOnboarding({
			onboarding: { outcome: "completed", closedAt: 1 },
			workspaces: { workspaces: [createdWorkspace] },
		});

		await expect.element(screen.getByTestId("app-body")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
	});

	it("hides the wizard when onboarding was previously skipped", async () => {
		const { screen } = renderOnboarding({
			onboarding: { outcome: "skipped", closedAt: 1 },
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
		await expect.element(screen.getByTestId("onboarding-connecting")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-continue")).toBeDisabled();
	});

	it("shows the wizard when the workspace list cannot be read", async () => {
		const { screen } = renderOnboarding({
			workspaces: { isUnavailable: true },
		});

		await expect.element(screen.getByTestId("onboarding-overlay")).toBeVisible();
		await expect.element(screen.getByTestId("app-body")).toBeVisible();
	});

	it("hides the wizard when persisted onboarding state cannot be read", async () => {
		const { screen } = renderOnboarding({
			get: async () => {
				throw new Error("kv unavailable");
			},
		});

		await expect.element(screen.getByTestId("app-body")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
	});

	it("hides the wizard when Kilo is unavailable", async () => {
		const { screen } = renderOnboarding({
			auth: { connectionUnavailable: true },
		});

		await expect.element(screen.getByTestId("app-body")).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
	});

	it("starts at sign-in when already signed in, then continues to create a workspace", async () => {
		const { screen, setActiveWorkspaceId } = renderOnboarding({
			auth: { authenticated: true },
		});

		await expect.element(screen.getByRole("heading", { name: "Connect to Kilo" })).toBeVisible();
		await expect.element(screen.getByTestId("onboarding-signed-in")).toBeVisible();
		await expect
			.element(screen.getByTestId("onboarding-progress-label"))
			.toHaveTextContent("1 of 2");

		await screen.getByTestId("onboarding-continue").click();
		await expect.element(screen.getByRole("heading", { name: "Create a workspace" })).toBeVisible();
		await screen.getByRole("button", { name: /Drop folders/ }).click();
		await expect.element(screen.getByText("alpha", { exact: true })).toBeVisible();
		await screen.getByTestId("onboarding-continue").click();

		await expect.element(screen.getByTestId("onboarding-overlay")).not.toBeInTheDocument();
		expect(setActiveWorkspaceId).toHaveBeenCalledWith(createdWorkspace.id);
	});

	it("does not report a workspace save error when only onboarding complete fails", async () => {
		const { screen, setActiveWorkspaceId } = renderOnboarding({
			auth: { authenticated: true },
			complete: async () => {
				throw new Error("kv write failed");
			},
		});

		await screen.getByTestId("onboarding-continue").click();
		await screen.getByRole("button", { name: /Drop folders/ }).click();
		await screen.getByTestId("onboarding-continue").click();

		expect(setActiveWorkspaceId).toHaveBeenCalledWith(createdWorkspace.id);
		await expect.element(screen.getByText("Could not save workspace.")).not.toBeInTheDocument();
	});
});
