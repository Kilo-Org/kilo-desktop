import { act, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AccountState } from "@kilo-desktop/plugin-core/contracts";
import type { GatewayModelDetails } from "@kilo-desktop/plugin-core/contracts";

import { renderInKernel, SIGNED_IN, SIGNED_OUT } from "../../test/kernel-harness";
import { ComposerActionView } from "../composer/composer-actions";
import { BUILTIN_COMPOSER_ACTIONS } from "../composer/builtin-actions";
import { ChatModelSelectionProvider } from "./ChatModelSelectionContext";
import type { ActiveModelSource } from "./ChatModelSelectionContext";

const CONTEXT = {
	workSessionId: "wses_1",
	chatId: null,
	directory: "/projects/app",
	workspaceId: null,
	workspaceFolders: [],
};

afterEach(() => {
	cleanup();
});

const signedInAuth: AccountState = SIGNED_IN;
const signedOutAuth: AccountState = SIGNED_OUT;

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

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

async function renderSelector({
	auth = signedInAuth,
	login,
	navigate = () => undefined,
	selection,
}: {
	auth?: AccountState;
	login?: () => void;
	navigate?: (path: string, options?: { search?: Record<string, unknown> }) => void;
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
				recommendedIndex?: number;
				providerName?: string;
				description?: string;
				isFree?: boolean;
				costTier?: "low" | "medium" | "high" | "very-high";
				details?: GatewayModelDetails;
			}[];
			defaults: Record<string, string>;
		};
		isCatalogPending: boolean;
		isSelectionPending?: boolean;
		isCatalogFetching?: boolean;
		isCatalogError?: boolean;
		modelSource?: ActiveModelSource;
	};
}) {
	const host = await renderInKernel(
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
			<ComposerActionView
				id="model"
				title="Model"
				implementation={BUILTIN_COMPOSER_ACTIONS.model!}
				context={CONTEXT}
			/>
		</ChatModelSelectionProvider>,
		{ core: { account: auth } },
	);
	if (login) host.signIn.mockImplementation(login);
	host.shell.calls.openSettings.mockImplementation((section) =>
		navigate(`/settings/${section ?? ""}`, undefined),
	);
	return host.screen;
}

function localSource(overrides: Partial<ActiveModelSource>): ActiveModelSource {
	return {
		providerId: "kilo-desktop-model-server",
		title: "Local Model Server",
		settingsSection: "local-model-server",
		status: null,
		hasModels: false,
		pending: false,
		...overrides,
	};
}

describe("KiloModelSelector", () => {
	it("shows the stored display name and effort on the trigger while the catalog is pending", async () => {
		const screen = await renderSelector({
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
		const content = screen.getByTestId("kilo-model-selector-content");
		await expect.element(content).toBeVisible();
		await expect.element(content).toHaveAttribute("data-side", "bottom");
		await expect.element(content).toHaveAttribute("data-align", "start");
		await expect.element(screen.getByTestId("kilo-model-selector-loading")).toBeVisible();
	});

	it("falls back to a loading placeholder on the trigger when nothing is stored yet", async () => {
		const screen = await renderSelector({
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

	it("shows a loading placeholder while a chat's model is unknown, even with the catalog loaded", async () => {
		const screen = await renderSelector({
			selection: {
				model: undefined,
				catalog: {
					providers: [{ id: "anthropic", name: "Anthropic", connected: true }],
					models: [
						{
							id: "anthropic/claude-sonnet",
							name: "Claude Sonnet",
							providerID: "anthropic",
							modelID: "claude-sonnet",
						},
					],
					defaults: {},
				},
				isCatalogPending: false,
				isSelectionPending: true,
			},
		});

		await expect
			.element(screen.getByTestId("kilo-model-selector-trigger"))
			.toHaveAttribute("aria-label", "Loading models");
	});

	it("offers sign-in from the Kilo Gateway list when signed out", async () => {
		const login = vi.fn();
		const navigate = vi.fn();
		const screen = await renderSelector({
			auth: signedOutAuth,
			login,
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
		expect(navigate).toHaveBeenCalledWith("/settings/kilo.shell/account", undefined);
	});

	it("hides the sign-in row unless the Kilo Gateway rail is selected", async () => {
		const screen = await renderSelector({
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
							providerName: "Anthropic",
							description: "Flagship reasoning model",
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

	it("disables the trigger when the catalog has loaded with no models", async () => {
		const screen = await renderSelector({
			selection: {
				model: undefined,
				catalog: { providers: [], models: [], defaults: {} },
				isCatalogPending: false,
			},
		});
		const trigger = screen.getByTestId("kilo-model-selector-trigger");

		await expect.element(trigger).toBeVisible();
		await expect.element(trigger).toBeDisabled();
	});

	it("keeps the trigger enabled while an empty catalog is still loading", async () => {
		const screen = await renderSelector({
			selection: {
				model: undefined,
				catalog: { providers: [], models: [], defaults: {} },
				isCatalogPending: true,
			},
		});
		const trigger = screen.getByTestId("kilo-model-selector-trigger");

		await expect.element(trigger).toBeVisible();
		await expect.element(trigger).toBeEnabled();
		await expect.element(trigger).toHaveAttribute("aria-label", "Loading models");
	});

	it("starts the local server and shows skeletons even when its cached provider is connected", async () => {
		const navigate = vi.fn();
		const startup = deferred<void>();
		const startLocalInference = vi.fn(() => startup.promise);
		const screen = await renderSelector({
			navigate,
			selection: {
				model: { providerID: "anthropic", modelID: "claude-sonnet" },
				name: "Claude Sonnet",
				modelSource: localSource({ status: { status: "idle" }, start: startLocalInference }),
				catalog: {
					providers: [
						{ id: "kilo-desktop-model-server", name: "Local Model Server", connected: true },
						{ id: "anthropic", name: "Anthropic", connected: true },
					],
					models: [
						{
							id: "anthropic/claude-sonnet",
							name: "Claude Sonnet",
							providerID: "anthropic",
							modelID: "claude-sonnet",
						},
					],
					defaults: { anthropic: "claude-sonnet" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		const localProvider = screen.getByTestId("kilo-model-selector-rail-kilo-desktop-model-server");
		await expect.element(localProvider).toBeVisible();
		await expect.element(localProvider).toBeEnabled();
		await expect.element(localProvider).toHaveAccessibleName("Local Model Server");
		await localProvider.click();
		expect(startLocalInference).toHaveBeenCalledOnce();
		await expect.element(screen.getByTestId("kilo-model-selector-loading")).toBeVisible();
		await expect.element(screen.getByText("Run AI on your device")).not.toBeInTheDocument();

		await act(async () => startup.resolve());

		await expect.element(screen.getByText("Run AI on your device")).toBeVisible();
		await expect
			.element(
				screen.getByText(
					"Private local inference that keeps your prompts, outputs, and data under your control.",
				),
			)
			.toBeVisible();
		await expect.element(screen.getByTestId("kilo-local-model-settings")).toBeVisible();

		await screen.getByRole("button", { name: "Add a local model" }).click();
		expect(navigate).toHaveBeenCalledWith("/settings/local-model-server", undefined);
	});

	it("shows the empty state once installed local models fail to appear in the catalog", async () => {
		const startLocalInference = vi.fn(async () => undefined);
		const screen = await renderSelector({
			selection: {
				model: { providerID: "anthropic", modelID: "claude-sonnet" },
				name: "Claude Sonnet",
				modelSource: localSource({
					status: { status: "ready" },
					hasModels: true,
					start: startLocalInference,
				}),
				catalog: {
					providers: [
						{ id: "kilo-desktop-model-server", name: "Local Model Server", connected: true },
						{ id: "anthropic", name: "Anthropic", connected: true },
					],
					models: [
						{
							id: "anthropic/claude-sonnet",
							name: "Claude Sonnet",
							providerID: "anthropic",
							modelID: "claude-sonnet",
						},
					],
					defaults: { anthropic: "claude-sonnet" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-selector-rail-kilo-desktop-model-server").click();
		expect(startLocalInference).not.toHaveBeenCalled();
		await expect.element(screen.getByText("Run AI on your device")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-local-model-settings")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-model-selector-loading")).not.toBeInTheDocument();
	});

	it("keeps showing skeletons while a catalog refetch may still add local models", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "anthropic", modelID: "claude-sonnet" },
				name: "Claude Sonnet",
				modelSource: localSource({ status: { status: "ready" }, hasModels: true }),
				catalog: {
					providers: [
						{ id: "kilo-desktop-model-server", name: "Local Model Server", connected: true },
						{ id: "anthropic", name: "Anthropic", connected: true },
					],
					models: [
						{
							id: "anthropic/claude-sonnet",
							name: "Claude Sonnet",
							providerID: "anthropic",
							modelID: "claude-sonnet",
						},
					],
					defaults: { anthropic: "claude-sonnet" },
				},
				isCatalogPending: false,
				isCatalogFetching: true,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-selector-rail-kilo-desktop-model-server").click();
		await expect.element(screen.getByTestId("kilo-model-selector-loading")).toBeVisible();
		await expect.element(screen.getByText("Run AI on your device")).not.toBeInTheDocument();
	});

	it("offers a server settings shortcut for installed local models", async () => {
		const navigate = vi.fn();
		const startLocalInference = vi.fn(async () => undefined);
		const screen = await renderSelector({
			navigate,
			selection: {
				model: { providerID: "kilo-desktop-model-server", modelID: "qwen-3" },
				name: "Qwen 3",
				modelSource: localSource({ status: { status: "ready" }, start: startLocalInference }),
				catalog: {
					providers: [
						{ id: "kilo-desktop-model-server", name: "Local Model Server", connected: true },
					],
					models: [
						{
							id: "kilo-desktop-model-server/qwen-3",
							name: "Qwen 3",
							providerID: "kilo-desktop-model-server",
							modelID: "qwen-3",
						},
					],
					defaults: {},
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-selector-rail-kilo-desktop-model-server").click();
		expect(startLocalInference).not.toHaveBeenCalled();
		await expect.element(screen.getByTestId("kilo-model-selector-loading")).not.toBeInTheDocument();
		await expect
			.element(screen.getByRole("button", { name: "Add a local model" }))
			.not.toBeInTheDocument();
		const serverSettings = screen.getByTestId("kilo-local-model-settings");
		await expect.element(serverSettings).toHaveAccessibleName("Server settings");

		await serverSettings.click();
		expect(navigate).toHaveBeenCalledWith("/settings/local-model-server", undefined);
	});

	it("shows provider rail arrows when more providers are above or below", async () => {
		const providers = Array.from({ length: 12 }, (_, index) => ({
			id: `provider-${index}`,
			name: `Provider ${index}`,
			connected: true,
		}));
		const screen = await renderSelector({
			selection: {
				model: { providerID: "provider-0", modelID: "model-0" },
				catalog: {
					providers,
					models: [
						{
							id: "provider-0/model-0",
							name: "Model 0",
							providerID: "provider-0",
							modelID: "model-0",
						},
					],
					defaults: { "provider-0": "model-0" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await expect.element(screen.getByTestId("kilo-model-selector-rail-more-below")).toBeVisible();

		const rail = screen.getByTestId("kilo-model-selector-rail").element();
		await screen.getByRole("button", { name: "Scroll providers down" }).click();
		await expect.poll(() => rail.scrollTop).toBeGreaterThan(0);
		await expect.element(screen.getByRole("button", { name: "Scroll providers up" })).toBeVisible();

		rail.scrollTop = rail.scrollHeight;
		fireEvent.scroll(rail);

		await expect.element(screen.getByTestId("kilo-model-selector-rail-more-above")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-model-selector-rail-more-below"))
			.not.toBeInTheDocument();
	});

	it("does not show a sign-in hint when already signed in", async () => {
		const screen = await renderSelector({
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

	it("groups Kilo Gateway models into Auto and Recommended sections", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "kilo-auto/efficient" },
				catalog: {
					providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }],
					models: [
						{
							id: "kilo/openai/gpt-5",
							name: "OpenAI: GPT-5",
							providerID: "kilo",
							modelID: "openai/gpt-5",
						},
						{
							id: "kilo/anthropic/claude-opus",
							name: "Claude Opus",
							providerID: "kilo",
							modelID: "anthropic/claude-opus",
							recommendedIndex: 1,
							costTier: "high",
						},
						{
							id: "kilo/kilo-auto/efficient",
							name: "Auto Efficient",
							providerID: "kilo",
							modelID: "kilo-auto/efficient",
							recommendedIndex: 0,
							costTier: "high",
						},
						{
							id: "kilo/organization-auto",
							name: "Organization Auto",
							providerID: "kilo",
							modelID: "organization-auto",
							costTier: "medium",
						},
					],
					defaults: { kilo: "kilo-auto/efficient" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await expect
			.element(screen.getByTestId("kilo-model-section-auto"))
			.toHaveTextContent("Auto models");
		await expect
			.element(screen.getByTestId("kilo-model-section-recommended"))
			.toHaveTextContent("Recommended");
		await expect
			.element(screen.getByTestId("kilo-model-section-kilo"))
			.toHaveTextContent("Kilo Gateway");
		await expect
			.element(screen.getByTestId("kilo-model-cost-kilo/kilo-auto/efficient"))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-model-cost-kilo/organization-auto"))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-model-cost-kilo/anthropic/claude-opus"))
			.toBeVisible();
	});

	it("opens Gateway model information without selecting the model", async () => {
		const setModel = vi.fn();
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "openai/gpt-5" },
				setModel,
				catalog: {
					providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }],
					models: [
						{
							id: "kilo/openai/gpt-5",
							name: "OpenAI: GPT-5",
							providerID: "kilo",
							modelID: "openai/gpt-5",
							description: "Kilo Gateway",
							details: {
								modelId: "openai/gpt-5",
								description: "A frontier coding model.",
								inputPricePerMillion: 1.25,
								outputPricePerMillion: 10,
								averageAttemptCostUsd: 2.58,
								kiloBenchScore: 0.753,
								enkryptRiskScore: 36.3,
								contextWindow: 1_000_000,
								maxOutputTokens: 128_000,
								mayTrainOnYourPrompts: false,
							},
						},
					],
					defaults: { kilo: "openai/gpt-5" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-info-kilo/openai/gpt-5").click();

		await expect
			.element(screen.getByTestId("kilo-model-info-popover-kilo/openai/gpt-5"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-model-info-logo-kilo/openai/gpt-5"))
			.toHaveAttribute("data-provider", "openai");
		await expect.element(screen.getByText("Kilo Bench completion")).toBeVisible();
		await expect.element(screen.getByText("75.3%")).toBeVisible();
		await expect
			.element(screen.getByRole("meter", { name: "Enkrypt risk score" }))
			.toHaveAttribute("aria-valuenow", "36.3");
		await expect.element(screen.getByText("Input", { exact: true })).toBeVisible();
		await expect.element(screen.getByText("$1.25/1M")).toBeVisible();
		await expect.element(screen.getByText("Prompt training")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-model-selector-content")).toBeVisible();
		expect(setModel).not.toHaveBeenCalled();
	});

	it("shows Gateway model information even when enriched details are unavailable", async () => {
		const setModel = vi.fn();
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "auto-frontier" },
				setModel,
				catalog: kiloCatalog,
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-info-kilo/auto-frontier").click();
		await expect
			.element(screen.getByTestId("kilo-model-info-popover-kilo/auto-frontier"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-model-info-logo-kilo/auto-frontier"))
			.toHaveAttribute("data-provider", "kilo");
		await expect
			.element(
				screen.getByTestId("kilo-model-info-popover-kilo/auto-frontier").getByText("Kilo Gateway"),
			)
			.toBeVisible();
		await expect.element(screen.getByText("Detailed metrics are unavailable.")).toBeVisible();
		expect(setModel).not.toHaveBeenCalled();
	});

	it("uses the Kilo logo when a model publisher has no registered icon", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "unknown-vendor/model" },
				catalog: {
					...kiloCatalog,
					models: [
						{
							id: "kilo/unknown-vendor/model",
							name: "Unknown Vendor Model",
							providerID: "kilo",
							modelID: "unknown-vendor/model",
						},
					],
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-info-kilo/unknown-vendor/model").click();
		const logo = screen.getByTestId("kilo-model-info-logo-kilo/unknown-vendor/model");
		await expect.element(logo).toHaveAttribute("data-provider", "unknown-vendor");
		expect(logo.element().querySelector("svg")).not.toBeNull();
	});

	it("omits the primary metric row when details have no benchmark", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "auto-frontier" },
				catalog: {
					...kiloCatalog,
					models: [
						{
							id: "kilo/auto-frontier",
							name: "Auto Frontier",
							providerID: "kilo",
							modelID: "auto-frontier",
							details: { modelId: "auto-frontier", isFree: true },
						},
					],
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-info-kilo/auto-frontier").click();
		const popover = screen.getByTestId("kilo-model-info-popover-kilo/auto-frontier");
		await expect.element(popover.getByText("Free")).toBeVisible();
		await expect.element(popover.getByText("Kilo Bench completion")).not.toBeInTheDocument();
		await expect.element(popover.getByText("Coding index")).not.toBeInTheDocument();
		await expect.element(popover.getByText("Code mode rank")).not.toBeInTheDocument();
		await expect
			.element(popover.getByText("Detailed metrics are unavailable."))
			.not.toBeInTheDocument();
	});

	it("keeps sub-cent Gateway costs distinguishable from free", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "auto-frontier" },
				catalog: {
					...kiloCatalog,
					models: [
						{
							id: "kilo/auto-frontier",
							name: "Auto Frontier",
							providerID: "kilo",
							modelID: "auto-frontier",
							details: {
								modelId: "auto-frontier",
								inputPricePerMillion: 0,
								averageAttemptCostUsd: 0.004,
							},
						},
					],
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-info-kilo/auto-frontier").click();
		const popover = screen.getByTestId("kilo-model-info-popover-kilo/auto-frontier");
		await expect.element(popover.getByText("$0.004", { exact: true })).toBeVisible();
		await expect.element(popover.getByText("$0.00/1M", { exact: true })).toBeVisible();
	});

	it("marks the current model independently of list highlighting", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "auto-frontier" },
				catalog: {
					...kiloCatalog,
					models: [
						...kiloCatalog.models,
						{
							id: "kilo/auto-balanced",
							name: "Auto Balanced",
							providerID: "kilo",
							modelID: "auto-balanced",
						},
					],
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		const current = screen.getByTestId("kilo-model-option-kilo/auto-frontier");
		const other = screen.getByTestId("kilo-model-option-kilo/auto-balanced");
		await expect.element(current.getByText("Current model")).toBeInTheDocument();
		fireEvent.pointerMove(other.element());
		await expect.element(current.getByText("Current model")).toBeInTheDocument();
		await expect.element(other.getByText("Current model")).not.toBeInTheDocument();
	});

	it("closes model information when the catalog scrolls", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "auto-frontier" },
				catalog: {
					...kiloCatalog,
					models: [
						...kiloCatalog.models,
						...Array.from({ length: 40 }, (_, index) => ({
							id: `kilo/model-${index}`,
							name: `Model ${index}`,
							providerID: "kilo",
							modelID: `model-${index}`,
						})),
					],
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-info-kilo/auto-frontier").click();
		const popover = screen.getByTestId("kilo-model-info-popover-kilo/auto-frontier");
		await expect.element(popover).toBeVisible();

		const list = screen.getByTestId("kilo-model-selector-list").element();
		await act(async () => {
			list.scrollTop = 300;
			fireEvent.scroll(list);
		});
		await expect.element(popover).not.toBeInTheDocument();
		expect(list.scrollTop).toBeGreaterThan(0);
	});

	it("shows row provider icons only when the list spans providers", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "auto-frontier" },
				catalog: {
					providers: [
						{ id: "kilo", name: "Kilo Gateway", connected: true },
						{ id: "anthropic", name: "Anthropic", connected: true },
					],
					models: [
						...kiloCatalog.models,
						{
							id: "anthropic/claude-sonnet",
							name: "Claude Sonnet",
							providerID: "anthropic",
							modelID: "claude-sonnet",
							description: "Flagship reasoning model",
							costTier: "very-high",
						},
					],
					defaults: { kilo: "auto-frontier", anthropic: "claude-sonnet" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await expect
			.element(screen.getByTestId("kilo-model-option-provider-kilo/auto-frontier"))
			.not.toBeInTheDocument();

		await screen.getByPlaceholder("Search models").fill("Claude");
		await expect
			.element(screen.getByTestId("kilo-model-option-provider-anthropic/claude-sonnet"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-model-cost-anthropic/claude-sonnet"))
			.not.toBeInTheDocument();
	});

	it("filters Gateway models by estimated cost while keeping auto routing separate", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "openai/gpt-low" },
				catalog: {
					providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }],
					models: [
						{
							id: "kilo/openai/gpt-low",
							name: "OpenAI: GPT Low",
							providerID: "kilo",
							modelID: "openai/gpt-low",
							costTier: "low",
						},
						{
							id: "kilo/openai/gpt-high",
							name: "OpenAI: GPT High",
							providerID: "kilo",
							modelID: "openai/gpt-high",
							costTier: "high",
						},
						{
							id: "kilo/kilo-auto/efficient",
							name: "Auto Efficient",
							providerID: "kilo",
							modelID: "kilo-auto/efficient",
							costTier: "high",
						},
					],
					defaults: { kilo: "openai/gpt-low" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await expect.element(screen.getByTestId("kilo-model-section-auto")).toBeVisible();
		await screen.getByTestId("kilo-model-filter-trigger").click();
		await expect
			.element(screen.getByTestId("kilo-model-filter-trigger"))
			.not.toHaveTextContent("Filter");
		await screen.getByTestId("kilo-model-filter-cost-trigger").click();
		await screen.getByTestId("kilo-model-filter-cost-high").click();
		await expect
			.element(screen.getByTestId("kilo-model-filter-trigger"))
			.toHaveAccessibleName("Filter models, 1 active");
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/openai/gpt-high"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/openai/gpt-low"))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/kilo-auto/efficient"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-model-section-auto")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-model-section-kilo")).not.toBeInTheDocument();
		await screen.getByTestId("kilo-model-filter-cost-auto").click();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/kilo-auto/efficient"))
			.toBeVisible();
		await screen.getByTestId("kilo-model-filter-clear").click();
		await expect.element(screen.getByTestId("kilo-model-section-auto")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-model-option-kilo/openai/gpt-low")).toBeVisible();
	});

	it("combines publisher choices with cost and offers a clear action when none match", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "openai/gpt-high" },
				catalog: {
					providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }],
					models: [
						{
							id: "kilo/openai/gpt-high",
							name: "OpenAI: GPT High",
							providerID: "kilo",
							modelID: "openai/gpt-high",
							costTier: "high",
						},
						{
							id: "kilo/anthropic/claude-high",
							name: "Anthropic: Claude High",
							providerID: "kilo",
							modelID: "anthropic/claude-high",
							costTier: "high",
						},
						{
							id: "kilo/openai/gpt-low",
							name: "OpenAI: GPT Low",
							providerID: "kilo",
							modelID: "openai/gpt-low",
							costTier: "low",
						},
					],
					defaults: { kilo: "openai/gpt-high" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-filter-trigger").click();
		await screen.getByTestId("kilo-model-filter-cost-trigger").click();
		await screen.getByTestId("kilo-model-filter-cost-high").click();
		await screen.getByTestId("kilo-model-filter-publisher-trigger").click();
		await screen.getByTestId("kilo-model-filter-publisher-openai").click();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/openai/gpt-high"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/anthropic/claude-high"))
			.not.toBeInTheDocument();
		await screen.getByTestId("kilo-model-filter-publisher-anthropic").click();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/anthropic/claude-high"))
			.toBeVisible();
		await screen.getByTestId("kilo-model-filter-publisher-openai").click();
		await screen.getByTestId("kilo-model-filter-cost-trigger").click();
		await screen.getByTestId("kilo-model-filter-cost-high").click();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/anthropic/claude-high"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/openai/gpt-high"))
			.not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-model-section-kilo")).not.toBeInTheDocument();
		await screen.getByTestId("kilo-model-filter-cost-low").click();
		await expect.element(screen.getByText("No models match these filters.")).toBeVisible();
		await screen.getByTestId("kilo-model-filter-trigger").click();
		await screen.getByTestId("kilo-model-filter-clear-empty").click();
		await expect.element(screen.getByTestId("kilo-model-option-kilo/openai/gpt-low")).toBeVisible();
	});

	it("groups ~-prefixed latest aliases under their publisher's single filter choice", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "anthropic/claude-pinned" },
				catalog: {
					providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }],
					models: [
						{
							id: "kilo/anthropic/claude-pinned",
							name: "Anthropic: Claude Pinned",
							providerID: "kilo",
							modelID: "anthropic/claude-pinned",
						},
						{
							id: "kilo/~anthropic/claude-latest",
							name: "Anthropic: Claude Latest",
							providerID: "kilo",
							modelID: "~anthropic/claude-latest",
						},
						{
							id: "kilo/openai/gpt",
							name: "OpenAI: GPT",
							providerID: "kilo",
							modelID: "openai/gpt",
						},
					],
					defaults: { kilo: "anthropic/claude-pinned" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-filter-trigger").click();
		await screen.getByTestId("kilo-model-filter-publisher-trigger").click();
		await expect
			.element(screen.getByTestId("kilo-model-filter-publisher-~anthropic"))
			.not.toBeInTheDocument();
		await screen.getByTestId("kilo-model-filter-publisher-anthropic").click();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/anthropic/claude-pinned"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/~anthropic/claude-latest"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/openai/gpt"))
			.not.toBeInTheDocument();
	});

	it("scopes Gateway filters away from other providers and cross-provider search", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "openai/gpt-high" },
				catalog: {
					providers: [
						{ id: "kilo", name: "Kilo Gateway", connected: true },
						{ id: "anthropic", name: "Anthropic", connected: true },
					],
					models: [
						{
							id: "kilo/openai/gpt-high",
							name: "OpenAI: GPT High",
							providerID: "kilo",
							modelID: "openai/gpt-high",
							costTier: "high",
						},
						{
							id: "kilo/anthropic/claude",
							name: "Anthropic: Claude Gateway",
							providerID: "kilo",
							modelID: "anthropic/claude",
							costTier: "high",
						},
						{
							id: "anthropic/claude",
							name: "Claude Direct",
							providerID: "anthropic",
							modelID: "claude",
							costTier: "low",
						},
					],
					defaults: { kilo: "openai/gpt-high", anthropic: "claude" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-filter-trigger").click();
		await screen.getByTestId("kilo-model-filter-cost-trigger").click();
		await screen.getByTestId("kilo-model-filter-cost-high").click();
		await screen.getByTestId("kilo-model-filter-publisher-trigger").click();
		await screen.getByTestId("kilo-model-filter-publisher-openai").click();
		await screen.getByTestId("kilo-model-filter-trigger").click();
		await screen.getByTestId("kilo-model-selector-rail-anthropic").click();
		await expect.element(screen.getByTestId("kilo-model-filter-trigger")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("kilo-model-option-anthropic/claude")).toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-model-cost-anthropic/claude"))
			.not.toBeInTheDocument();
		await screen.getByTestId("kilo-model-selector-rail-kilo").click();
		await expect
			.element(screen.getByTestId("kilo-model-filter-trigger"))
			.toHaveAccessibleName("Filter models, 2 active");
		await screen.getByPlaceholder("Search models").fill("Claude");
		await expect.element(screen.getByTestId("kilo-model-filter-trigger")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/anthropic/claude"))
			.toBeVisible();
		await expect.element(screen.getByTestId("kilo-model-option-anthropic/claude")).toBeVisible();
		await screen.getByPlaceholder("Search models").fill("");
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/openai/gpt-high"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/anthropic/claude"))
			.not.toBeInTheDocument();
	});

	it("keeps a long publisher submenu scrollable", async () => {
		const models = Array.from({ length: 15 }, (_, index) => ({
			id: `kilo/publisher-${index}/model`,
			name: `Publisher ${index}: Model`,
			providerID: "kilo",
			modelID: `publisher-${index}/model`,
		}));
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "publisher-0/model" },
				catalog: {
					providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }],
					models,
					defaults: { kilo: "publisher-0/model" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		await screen.getByTestId("kilo-model-filter-trigger").click();
		await screen.getByTestId("kilo-model-filter-publisher-trigger").click();
		await expect.element(screen.getByTestId("kilo-model-filter-publisher-content")).toBeVisible();
		const submenu = screen.getByTestId("kilo-model-filter-publisher-content").element();
		expect(submenu.scrollHeight).toBeGreaterThan(submenu.clientHeight);
		await screen.getByTestId("kilo-model-filter-publisher-publisher-14").click();
		await expect
			.element(screen.getByTestId("kilo-model-option-kilo/publisher-14/model"))
			.toBeVisible();
	});

	it("does not snap the catalog list back up while scrolling down", async () => {
		const models = Array.from({ length: 40 }, (_, index) => ({
			id: `anthropic/model-${index}`,
			name: `Model ${index}`,
			providerID: "anthropic",
			modelID: `model-${index}`,
			description: `Description ${index}`,
		}));
		const screen = await renderSelector({
			selection: {
				model: { providerID: "anthropic", modelID: "model-0" },
				catalog: {
					providers: [{ id: "anthropic", name: "Anthropic", connected: true }],
					models,
					defaults: { anthropic: "model-0" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		const list = screen.getByTestId("kilo-model-selector-list").element();
		await expect.element(screen.getByTestId("kilo-model-option-anthropic/model-0")).toBeVisible();

		await act(async () => {
			list.scrollTop = 900;
			fireEvent.scroll(list);
		});
		await expect
			.element(screen.getByTestId("kilo-model-option-anthropic/model-0"))
			.not.toBeInTheDocument();

		const scrolledTo = list.scrollTop;
		expect(scrolledTo).toBeGreaterThan(700);

		const offscreenHighlight = list.querySelector("[cmdk-item]");
		expect(offscreenHighlight).toBeTruthy();
		await act(async () => {
			fireEvent.pointerMove(offscreenHighlight!);
		});

		expect(list.scrollTop).toBe(scrolledTo);
	});

	it("scrolls the catalog list from keyboard navigation", async () => {
		const models = Array.from({ length: 40 }, (_, index) => ({
			id: `anthropic/model-${index}`,
			name: `Model ${index}`,
			providerID: "anthropic",
			modelID: `model-${index}`,
			description: `Description ${index}`,
		}));
		const screen = await renderSelector({
			selection: {
				model: { providerID: "anthropic", modelID: "model-0" },
				catalog: {
					providers: [{ id: "anthropic", name: "Anthropic", connected: true }],
					models,
					defaults: { anthropic: "model-0" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		const list = screen.getByTestId("kilo-model-selector-list").element();
		expect(list.scrollTop).toBe(0);

		await act(async () => {
			fireEvent.keyDown(screen.getByPlaceholder("Search models").element(), { key: "End" });
		});

		expect(list.scrollTop).toBeGreaterThan(700);
	});

	it("marks free models with a Free label, data-training icon, and data-auto-free attribute", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "kilo-auto/free" },
				name: "Auto Free",
				catalog: {
					providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }],
					models: [
						{
							id: "kilo/kilo-auto/free",
							name: "Auto Free",
							providerID: "kilo",
							modelID: "kilo-auto/free",
							description: "Kilo Gateway",
							isFree: true,
						},
						{
							id: "kilo/auto-frontier",
							name: "Auto Frontier",
							providerID: "kilo",
							modelID: "auto-frontier",
							description: "Kilo Gateway",
						},
					],
					defaults: { kilo: "kilo-auto/free" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		const freeRow = screen.getByTestId("kilo-model-option-kilo/kilo-auto/free");
		await expect.element(freeRow).toHaveAttribute("data-auto-free", "1");
		await expect
			.element(screen.getByTestId("kilo-model-free-label-kilo/kilo-auto/free"))
			.toBeVisible();
		const trainingIndicator = screen.getByTestId("kilo-model-data-training-kilo/kilo-auto/free");
		await expect.element(trainingIndicator).toBeVisible();
		await expect
			.element(trainingIndicator)
			.toHaveAttribute("aria-label", "Data may be used for training.");

		const paidRow = screen.getByTestId("kilo-model-option-kilo/auto-frontier");
		await expect.element(paidRow).not.toHaveAttribute("data-auto-free");
		await expect
			.element(screen.getByTestId("kilo-model-free-label-kilo/auto-frontier"))
			.not.toBeInTheDocument();
	});

	it("marks recommended models flagged free via Gateway details", async () => {
		const screen = await renderSelector({
			selection: {
				model: { providerID: "kilo", modelID: "kilo-auto/free" },
				name: "Auto Free",
				catalog: {
					providers: [{ id: "kilo", name: "Kilo Gateway", connected: true }],
					models: [
						{
							id: "kilo/kilo-auto/free",
							name: "Auto Free",
							providerID: "kilo",
							modelID: "kilo-auto/free",
							description: "Kilo Gateway",
							isFree: true,
						},
						{
							id: "kilo/poolside/laguna-s-2.1:free",
							name: "Poolside Laguna S 2.1",
							providerID: "kilo",
							modelID: "poolside/laguna-s-2.1:free",
							description: "Kilo Gateway",
							recommendedIndex: 0,
							details: {
								modelId: "poolside/laguna-s-2.1:free",
								isFree: true,
								mayTrainOnYourPrompts: true,
							},
						},
					],
					defaults: { kilo: "kilo-auto/free" },
				},
				isCatalogPending: false,
			},
		});

		await screen.getByTestId("kilo-model-selector-trigger").click();
		const freeRow = screen.getByTestId("kilo-model-option-kilo/poolside/laguna-s-2.1:free");
		await expect.element(freeRow).toHaveAttribute("data-auto-free", "1");
		await expect
			.element(screen.getByTestId("kilo-model-free-label-kilo/poolside/laguna-s-2.1:free"))
			.toBeVisible();
		await expect
			.element(screen.getByTestId("kilo-model-data-training-kilo/poolside/laguna-s-2.1:free"))
			.toBeVisible();
	});
});
