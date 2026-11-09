import { describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	KernelDataCollection,
	KernelError,
	KernelShell,
	type DomainProvider,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { WorkStyleOnboarding } from "@kilo-desktop/plugin-agent/contracts";
import { renderShell, type GuestPlugin } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../plugin.json";
import { TELEMETRY_DEFINITIONS } from "../contracts";
import { createTelemetryMainEntry } from "../main/entry";
import { telemetryWebEntry } from "./index";

async function renderApp(
	options: {
		desktop?: boolean;
		consent?: boolean;
		setChoice?: (allowed: boolean) => void;
		guests?: readonly GuestPlugin[];
	} = {},
) {
	const provider = { track: vi.fn(async () => {}), dispose: vi.fn(async () => {}) };
	const openExternal = vi.fn(() => true);
	await renderShell(
		[
			{
				manifest,
				definitions: TELEMETRY_DEFINITIONS,
				main: createTelemetryMainEntry({ createProvider: () => provider }),
				web: telemetryWebEntry,
			},
			...(options.guests ?? []),
		],
		{
			desktop: options.desktop ?? true,
			beforeRender: (main) => {
				main.kernelSdk.domains.provide(KernelShell, {
					initialState: {},
					methods: {
						openExternal,
						showItemInFolder: () => {},
						showLogs: () => ({ revealed: true }),
						logFilePath: () => "/logs/main.log",
					},
				});
				if (options.consent === undefined) return;
				const consent = main.kernelSdk.domains.provide(KernelDataCollection, {
					initialState: {
						choice: options.consent,
						allowed: options.consent,
						installationId: "install-1",
						environment: "preview",
					},
					methods: {
						setChoice: ({ allowed }) => {
							options.setChoice?.(allowed);
							consent.setState({ ...consent.state, choice: allowed, allowed });
						},
					},
				});
			},
		},
	);
	return { provider, openExternal };
}

const toggle = () => page.getByTestId("privacy-data-collection");

describe("Privacy settings", () => {
	it("shows the saved choice and saves a change", async () => {
		const setChoice = vi.fn();
		await renderApp({ consent: true, setChoice });
		window.location.hash = "#/settings/privacy";

		await expect.element(toggle()).toHaveAttribute("aria-checked", "true");
		await toggle().click();

		await expect.element(toggle()).toHaveAttribute("aria-checked", "false");
		expect(setChoice).toHaveBeenCalledWith(false);
	});

	it("explains a failed change and keeps showing what was saved", async () => {
		await renderApp({
			consent: true,
			setChoice: () => {
				throw new KernelError("BUSINESS", "Could not save data collection preference.");
			},
		});
		window.location.hash = "#/settings/privacy";

		await toggle().click();

		await expect
			.element(page.getByText("Could not save data collection preference."))
			.toBeVisible();
		await expect.element(toggle()).toHaveAttribute("aria-checked", "true");
	});

	it("shows a placeholder until consent is known", async () => {
		await renderApp();
		window.location.hash = "#/settings/privacy";

		await expect
			.element(page.getByRole("status", { name: "Loading privacy settings" }))
			.toBeVisible();
	});

	it("opens the free-model data handling docs in the browser", async () => {
		const { openExternal } = await renderApp({ consent: true });
		window.location.hash = "#/settings/privacy";

		await page.getByText("here", { exact: true }).click();

		await vi.waitFor(() =>
			expect(openExternal).toHaveBeenCalledWith(
				{ url: "https://kilo.ai/docs/getting-started/using-kilo-for-free" },
				expect.anything(),
			),
		);
	});

	it("is only offered in the desktop app", async () => {
		await renderApp({ desktop: false, consent: false });
		await page.getByTestId("nav-settings").click();

		await expect.element(page.getByTestId("settings-section-appearance")).toBeVisible();
		await expect.element(page.getByTestId("settings-section-privacy")).not.toBeInTheDocument();
	});
});

describe("page visits", () => {
	it("reports each path the main window visits", async () => {
		const { provider } = await renderApp({ consent: true });

		window.location.hash = "#/settings/privacy";
		await vi.waitFor(() =>
			expect(provider.track).toHaveBeenCalledWith(
				expect.objectContaining({ event: "Page Visit", data: { path: "/settings/privacy" } }),
			),
		);
		window.location.hash = "#/";

		await vi.waitFor(() =>
			expect(provider.track).toHaveBeenLastCalledWith(
				expect.objectContaining({ event: "Page Visit", data: { path: "/plugins/chat" } }),
			),
		);
	});
});

/** kilo.agent's work-style onboarding step, announcing as the real one does. */
function workStyleStep() {
	let events: DomainProvider<typeof WorkStyleOnboarding> | undefined;
	const plugin: GuestPlugin = {
		manifest: testManifest("kilo.agent", {
			domains: [{ id: "work-style-onboarding", home: "renderer" }],
		}),
		definitions: { domains: [WorkStyleOnboarding] },
		web: {
			activate(sdk: PluginSdk) {
				events = sdk.domains.provide(WorkStyleOnboarding, { initialState: {}, methods: {} });
			},
		},
	};
	return { plugin, events: () => events! };
}

describe("work-style onboarding", () => {
	it("reports the step shown and the style chosen, with origin's names", async () => {
		const step = workStyleStep();
		const { provider } = await renderApp({ consent: true, guests: [step.plugin] });

		step.events().emit("shown", {});
		step.events().emit("selected", { style: "human-in-the-loop" });

		await vi.waitFor(() => {
			expect(provider.track).toHaveBeenCalledWith(
				expect.objectContaining({ event: "Work Style Onboarding Shown", data: {} }),
			);
			expect(provider.track).toHaveBeenCalledWith(
				expect.objectContaining({
					event: "Work Style Selected",
					data: { style: "human-in-the-loop" },
				}),
			);
		});
	});
});
