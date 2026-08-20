import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { AppProviders } from "@/app/AppProviders";
import { WEB_FEATURES } from "@/features/features";
import {
	PLUGIN_ZONE_CONTRIBUTIONS,
	registerPluginZoneContributions,
} from "@/features/plugin-zones";
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { createAppFeatureSystem } from "@/platform/featureSystem";

afterEach(() => {
	cleanup();
	localStorage.clear();
});

/**
 * App-level: router + provider composition. Feature CRUD lives in browser/e2e tiers.
 */
describe("AppProviders (app-level)", () => {
	it("keeps the kilo-ui workspaces lifecycle active without rendering its home widget", async () => {
		const localApi = createBrowserLocalApi();
		const system = createAppFeatureSystem(localApi, WEB_FEATURES);
		render(
			<AppProviders localApi={localApi} system={system}>
				<div>Non-home route</div>
			</AppProviders>,
		);

		system.getSdk("kilo-ui").events.emit("open-manager");

		await expect.element(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();
	});

	it("boots the shell and navigates into registered feature routes", async () => {
		const localApi = createBrowserLocalApi();
		// Force the todos LaunchDarkly flag on for this app-level test — the
		// browser fallback returns `{}` by default and the todos nav entry is
		// gated by `featureFlag: "todo-feature"`, so without this override
		// the sidebar icon would be hidden and the nav-click would time out.
		const gatedApi: typeof localApi = {
			...localApi,
			featureFlags: {
				...localApi.featureFlags,
				getAllFlags: async () => ({ "todo-feature": true }),
			},
		};
		const system = createAppFeatureSystem(gatedApi, WEB_FEATURES);
		registerPluginZoneContributions(system, PLUGIN_ZONE_CONTRIBUTIONS, {
			desktopAvailable: false,
		});
		const { baseElement } = render(<AppProviders localApi={gatedApi} system={system} />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("app-sidebar")).toBeVisible();
		await expect.element(screen.getByTestId("global-new")).toBeVisible();

		// The todos nav entry is derived from the plugin manifest route.
		await screen.getByTestId("nav-todos").click();
		await expect.element(screen.getByTestId("plugin-page-heading")).toBeVisible();
		// Todos is Electron-only — browser mode renders an explicit unavailable state.
		await expect.element(screen.getByTestId("plugin-page-unavailable")).toBeVisible();
	});

	it("opens Appearance settings from the app bar", async () => {
		const localApi = createBrowserLocalApi();
		const system = createAppFeatureSystem(localApi, WEB_FEATURES);
		registerPluginZoneContributions(system, PLUGIN_ZONE_CONTRIBUTIONS, {
			desktopAvailable: false,
		});
		const { baseElement } = render(<AppProviders localApi={localApi} system={system} />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("nav-settings")).toBeVisible();
		await screen.getByTestId("nav-settings").click();
		await expect.element(screen.getByTestId("settings-page")).toBeVisible();
		await expect.element(screen.getByTestId("appearance-settings")).toBeVisible();
		await expect.element(screen.getByTestId("settings-section-appearance")).toBeVisible();
		await expect.element(screen.getByTestId("settings-section-kilo-account")).toBeVisible();
		await expect.element(screen.getByTestId("settings-empty")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("settings-back")).toBeVisible();
		await expect.element(screen.getByTestId("nav-settings")).toBeVisible();
		await expect.element(screen.getByTestId("zone-sidebar")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("global-new")).not.toBeInTheDocument();

		await screen.getByTestId("settings-back").click();
		await expect.element(screen.getByTestId("nav-settings")).toBeVisible();
		await expect.element(screen.getByTestId("settings-back")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("global-new")).toBeVisible();
	});
});
