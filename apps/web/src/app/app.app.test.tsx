import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { LocalApi, ShellNavigationTarget } from "@kilo-desktop/contracts";

import { AppProviders } from "@/app/AppProviders";
import { WEB_FEATURES } from "@/features/features";
import {
	PLUGIN_ZONE_CONTRIBUTIONS,
	registerPluginZoneContributions,
} from "@/features/plugin-zones";
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { createAppFeatureSystem } from "@/platform/featureSystem";
import { router } from "@/router";

afterEach(async () => {
	cleanup();
	localStorage.clear();
	router.history.replace("/");
	await router.load();
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
		await expect.element(screen.getByTestId("new-chat")).toBeVisible();

		// The todos nav entry is derived from the plugin manifest route.
		await screen.getByTestId("nav-todos").click();
		await expect.element(screen.getByRole("heading", { name: "Todo List" })).toBeVisible();
		// Todos is Electron-only — browser mode renders an explicit unavailable state.
		await expect.element(screen.getByTestId("plugin-page-unavailable")).toBeVisible();
	});

	it("keeps catalogModel search on the local model server settings route", async () => {
		router.history.push("/settings/local-model-server?catalogModel=catalog-model");
		await router.load();
		expect(router.state.location.pathname).toBe("/settings/local-model-server");
		expect(router.state.location.search).toMatchObject({ catalogModel: "catalog-model" });
	});

	it("applies shell:navigate from LocalApi to the router", async () => {
		let send: ((target: ShellNavigationTarget) => void) | undefined;
		const base = createBrowserLocalApi();
		const localApi: LocalApi = {
			...base,
			shell: {
				...base.shell,
				onNavigate(listener) {
					send = listener;
					return () => {
						send = undefined;
					};
				},
			},
		};
		const system = createAppFeatureSystem(localApi, WEB_FEATURES);
		render(<AppProviders localApi={localApi} system={system} />);

		expect(send).toBeTypeOf("function");
		send?.({
			path: "/settings/local-model-server",
			search: { catalogModel: "catalog-model" },
		});
		await router.load();
		expect(router.state.location.pathname).toBe("/settings/local-model-server");
		expect(router.state.location.search).toMatchObject({ catalogModel: "catalog-model" });
	});

	it("renders pane windows without the main application chrome", async () => {
		router.history.push(
			"/plugins/chat?paneWindow=true&panePluginId=kilo-ui&paneSessionId=draft&paneId=missing",
		);
		await router.load();
		expect(router.state.location.search).toMatchObject({
			paneWindow: true,
			panePluginId: "kilo-ui",
			paneSessionId: "draft",
			paneId: "missing",
		});
		const localApi = createBrowserLocalApi();
		const paneApi: typeof localApi = {
			...localApi,
			shell: {
				...localApi.shell,
				windowRole: "pane",
			},
		};
		const system = createAppFeatureSystem(paneApi, WEB_FEATURES);
		const { baseElement } = render(<AppProviders localApi={paneApi} system={system} />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("detached-pane-shell")).toBeVisible();
		await expect.element(screen.getByTestId("chat-pane-dock")).toBeVisible();
		await expect.element(screen.getByTestId("app-sidebar")).not.toBeInTheDocument();
	});

	it("renders desktop plugin zone contributions inside the SDK provider", async () => {
		const localApi = createBrowserLocalApi();
		const system = createAppFeatureSystem(localApi, WEB_FEATURES);
		await router.navigate({ to: "/plugins/$", params: { _splat: "chat" } });
		registerPluginZoneContributions(system, PLUGIN_ZONE_CONTRIBUTIONS, {
			desktopAvailable: true,
		});
		const { baseElement } = render(<AppProviders localApi={localApi} system={system} />);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("kilo-chat-page")).toBeVisible();
		await expect.element(screen.getByRole("combobox", { name: "Select workspace" })).toBeVisible();
		await expect.element(screen.getByText("Something went wrong!")).not.toBeInTheDocument();
	});

	it("opens Appearance settings from the sidebar footer", async () => {
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
		await expect.element(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
		await expect.element(screen.getByTestId("account-page")).toBeVisible();
		await expect.element(screen.getByTestId("settings-section-account")).toBeVisible();
		await expect.element(screen.getByTestId("settings-section-appearance")).toBeVisible();
		await expect.element(screen.getByTestId("settings-section-kilo-providers")).toBeVisible();
		await expect.element(screen.getByTestId("settings-empty")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("settings-back")).toBeVisible();
		await expect.element(screen.getByTestId("nav-settings")).toBeVisible();
		await expect
			.element(screen.getByTestId("app-sidebar-primary"))
			.toHaveAttribute("aria-hidden", "true");
		await expect.element(screen.getByTestId("zone-sidebar")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("new-chat")).not.toBeInTheDocument();

		await screen.getByTestId("settings-back").click();
		await expect.element(screen.getByTestId("nav-settings")).toBeVisible();
		await expect.element(screen.getByTestId("settings-back")).not.toBeInTheDocument();
		await expect
			.element(screen.getByTestId("app-sidebar-primary"))
			.toHaveAttribute("aria-hidden", "false");
		await expect.element(screen.getByTestId("new-chat")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-chat-page")).toBeVisible();
		await expect.element(screen.getByTestId("kilo-chat-thread")).toBeVisible();
		await expect.element(screen.getByTestId("chat-right-panel-toggle")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("chat-pane-arrangement")).not.toBeInTheDocument();
	});
});
