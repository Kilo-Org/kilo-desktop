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
		const system = createAppFeatureSystem(localApi, WEB_FEATURES);
		registerPluginZoneContributions(system, PLUGIN_ZONE_CONTRIBUTIONS, {
			desktopAvailable: false,
		});
		const { baseElement } = render(<AppProviders localApi={localApi} system={system} />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("app-sidebar")).toBeVisible();

		// The bundled plugins contribute no sidebar nav entries — navigate via the router.
		window.location.hash = "#/plugins/todos";
		await expect.element(screen.getByTestId("plugin-page-heading")).toBeVisible();
		// Todos is Electron-only — browser mode renders an explicit unavailable state.
		await expect.element(screen.getByTestId("plugin-page-unavailable")).toBeVisible();
	});
});
