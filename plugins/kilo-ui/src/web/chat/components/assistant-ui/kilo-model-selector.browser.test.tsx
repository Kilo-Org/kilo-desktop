import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { KiloAuthContext, type KiloAuthContextValue } from "../../../account/KiloAuthContext.js";
import { ChatModelSelectionProvider } from "../../model-selection/ChatModelSelectionContext.js";
import { KiloModelSelector } from "./kilo-model-selector.js";

afterEach(() => {
	cleanup();
});

const signedInAuth: KiloAuthContextValue = {
	isLoading: false,
	connectionUnavailable: false,
	authenticated: true,
	profile: null,
	deviceAuth: { status: "idle" },
	isRefreshing: false,
	isSwitchingOrg: false,
	profileError: null,
	orgError: null,
	login: () => undefined,
	cancelLogin: () => undefined,
	logout: () => undefined,
	refreshProfile: () => undefined,
	setOrganization: () => undefined,
	dismissOrgError: () => undefined,
	openExternal: () => undefined,
};

const signedOutAuth: KiloAuthContextValue = {
	...signedInAuth,
	authenticated: false,
};

const kiloCatalog = {
	providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }],
	models: [
		{
			id: "kilo/auto-frontier",
			name: "Auto Frontier",
			providerID: "kilo",
			modelID: "auto-frontier",
			description: "Kilo Gateway",
		},
	],
	defaults: { kilo: "auto-frontier" },
};

function renderSelector({
	auth = signedInAuth,
	navigate = () => undefined,
	selection,
}: {
	auth?: KiloAuthContextValue;
	navigate?: (path: string) => void;
	selection: {
		model: { providerID: string; modelID: string } | undefined;
		setModel?: () => void;
		effort?: string;
		setEffort?: () => void;
		name?: string;
		efforts?: { id: string; name: string }[];
		catalog?: {
			providers: { id: string; name: string; connected: boolean }[];
			models: {
				id: string;
				name: string;
				providerID: string;
				modelID: string;
				description?: string;
			}[];
			defaults: Record<string, string>;
		};
		isCatalogPending: boolean;
		isCatalogError?: boolean;
	};
}) {
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		navigation: { navigate },
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const { baseElement } = render(
		<SdkProvider system={system}>
			<KiloAuthContext.Provider value={auth}>
				<ChatModelSelectionProvider
					value={{
						setModel: () => undefined,
						effort: undefined,
						setEffort: () => undefined,
						name: undefined,
						efforts: undefined,
						catalog: undefined,
						isCatalogError: false,
						...selection,
					}}
				>
					<KiloModelSelector />
				</ChatModelSelectionProvider>
			</KiloAuthContext.Provider>
		</SdkProvider>,
	);
	return page.elementLocator(baseElement);
}

describe("KiloModelSelector", () => {
	it("shows the stored display name and effort on the trigger while the catalog is pending", async () => {
		const screen = renderSelector({
			selection: {
				model: { providerID: "anthropic", modelID: "claude-sonnet" },
				effort: "high",
				name: "Claude Sonnet",
				efforts: [
					{ id: "low", name: "Low" },
					{ id: "medium", name: "Med" },
					{ id: "high", name: "High" },
				],
				isCatalogPending: true,
			},
		});
		const trigger = screen.getByTestId("kilo-model-selector-trigger");

		await expect.element(trigger).toBeVisible();
		await expect.element(trigger).toHaveAttribute("aria-busy", "true");
		await expect.element(trigger).toBeEnabled();
		await expect.element(trigger).toHaveAttribute("aria-label", "Select model");
		await expect.element(screen.getByText("Claude Sonnet")).toBeVisible();
		await expect.element(screen.getByText("High")).toBeVisible();

		await trigger.click();
		await expect.element(screen.getByTestId("kilo-model-selector-content")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-model-selector-loading")).toBeVisible();
	});

	it("falls back to a loading placeholder on the trigger when nothing is stored yet", async () => {
		const screen = renderSelector({
			selection: {
				model: undefined,
				isCatalogPending: true,
			},
		});
		const trigger = screen.getByTestId("kilo-model-selector-trigger");

		await expect.element(trigger).toBeVisible();
		await expect.element(trigger).toBeEnabled();
		await expect.element(trigger).toHaveAttribute("aria-label", "Loading models");
		await expect.element(screen.getByText("Loading models…")).toBeInTheDocument();

		await trigger.click();
		await expect.element(screen.getByTestId("kilo-model-selector-loading")).toBeVisible();
	});

	it("offers sign-in from the Kilo Gateway list when signed out", async () => {
		const login = vi.fn();
		const navigate = vi.fn();
		const screen = renderSelector({
			auth: { ...signedOutAuth, login },
			navigate,
			selection: {
				model: { providerID: "kilo", modelID: "auto-frontier" },
				name: "Auto Frontier",
				catalog: kiloCatalog,
				isCatalogPending: false,
			},
		});
		const trigger = screen.getByTestId("kilo-model-selector-trigger");

		await expect.element(trigger).toHaveAttribute("aria-label", "Select model");
		await expect.element(screen.getByTestId("kilo-model-selector-warning")).not.toBeInTheDocument();

		await trigger.click();
		await expect.element(screen.getByTestId("kilo-model-selector-signin")).toBeVisible();
		await expect.element(screen.getByText("Connect to Kilo")).toBeVisible();

		await screen.getByTestId("kilo-model-selector-signin").click();
		expect(login).toHaveBeenCalledOnce();
		expect(navigate).toHaveBeenCalledWith("/settings/kilo-providers", undefined);
	});

	it("hides the sign-in row unless the Kilo Gateway rail is selected", async () => {
		const screen = renderSelector({
			auth: signedOutAuth,
			selection: {
				model: { providerID: "anthropic", modelID: "claude-sonnet" },
				name: "Claude Sonnet",
				catalog: {
					providers: [
						{ id: "kilo", name: "Kilo Gateway", connected: true },
						{ id: "anthropic", name: "Anthropic", connected: true },
					],
					models: [
						{
							id: "kilo/auto-frontier",
							name: "Auto Frontier",
							providerID: "kilo",
							modelID: "auto-frontier",
							description: "Kilo Gateway",
						},
						{
							id: "anthropic/claude-sonnet",
							name: "Claude Sonnet",
							providerID: "anthropic",
							modelID: "claude-sonnet",
							description: "Anthropic",
						},
					],
					defaults: { kilo: "auto-frontier", anthropic: "claude-sonnet" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await expect.element(screen.getByTestId("kilo-model-selector-content")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-model-selector-signin")).not.toBeInTheDocument();

		await screen.getByTestId("kilo-model-selector-rail-kilo").click();
		await expect.element(screen.getByTestId("kilo-model-selector-signin")).toBeVisible();
	});

	it("does not show a sign-in hint when already signed in", async () => {
		const screen = renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "auto-frontier" },
				name: "Auto Frontier",
				catalog: kiloCatalog,
				isCatalogPending: false,
			},
		});
		const trigger = screen.getByTestId("kilo-model-selector-trigger");

		await expect.element(trigger).toHaveAttribute("aria-label", "Select model");
		await expect.element(screen.getByTestId("kilo-model-selector-warning")).not.toBeInTheDocument();

		await trigger.click();
		await expect.element(screen.getByTestId("kilo-model-selector-content")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-model-selector-signin")).not.toBeInTheDocument();
	});
});
