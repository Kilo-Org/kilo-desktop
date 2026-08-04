import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { AppProviders } from "@/app/AppProviders";
import { WEB_FEATURES } from "@/features/features";
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { createAppFeatureSystem } from "@/platform/featureSystem";

afterEach(() => {
	cleanup();
});

/**
 * App-level: router + provider composition. Feature CRUD lives in browser/e2e tiers.
 */
describe("AppProviders (app-level)", () => {
	it("boots the shell and navigates into registered feature routes", async () => {
		const localApi = createBrowserLocalApi();
		const system = createAppFeatureSystem(localApi, WEB_FEATURES);
		const { baseElement } = render(<AppProviders localApi={localApi} system={system} />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("app-sidebar")).toBeVisible();
		await expect.element(screen.getByRole("combobox", { name: "Select workspace" })).toBeVisible();

		// The todos nav entry is derived from the plugin manifest route.
		await screen.getByTestId("nav-todos").click();
		await expect.element(screen.getByTestId("plugin-page-heading")).toBeVisible();
		// Todos is Electron-only — browser mode renders an explicit unavailable state.
		await expect.element(screen.getByTestId("plugin-page-unavailable")).toBeVisible();
	});
});
