import { cleanup, render } from "@testing-library/react";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { SidebarProvider } from "@anaconda-agentic-desktop/ui/components/sidebar";
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { createAppFeatureSystem } from "@/platform/featureSystem";

import { SettingsEmptyState } from "./SettingsEmptyState";
import { SettingsLayout } from "./SettingsLayout";
import { SettingsSectionView } from "./SettingsSectionView";
import { SettingsSidebar } from "./SettingsSidebar";

import type { PluginSettingsSection } from "@/features/plugin-settings";

afterEach(cleanup);

function AlphaPanel() {
	return <div data-qa-id="alpha-panel">Alpha panel</div>;
}

function BetaPanel() {
	return <div data-qa-id="beta-panel">Beta panel</div>;
}

function makeSection(overrides: Partial<PluginSettingsSection> = {}): PluginSettingsSection {
	return {
		pluginId: "alpha",
		id: "alpha",
		title: "Alpha",
		component: AlphaPanel,
		icon: undefined,
		iconComponent: undefined,
		priority: 1,
		featureFlag: undefined,
		browserSafe: true,
		...overrides,
	};
}

function renderSettings(sections: PluginSettingsSection[], initial = "/settings") {
	const api = createBrowserLocalApi();
	const system = createAppFeatureSystem(api);
	const rootRoute = createRootRoute({
		component: () => <Outlet />,
	});
	const settingsRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/settings",
		component: () => (
			<>
				<SettingsSidebar sections={sections} />
				<SettingsLayout>
					<Outlet />
				</SettingsLayout>
			</>
		),
	});
	const indexRoute = createRoute({
		getParentRoute: () => settingsRoute,
		path: "/",
		component: () => <SettingsEmptyState />,
	});
	const sectionRoute = createRoute({
		getParentRoute: () => settingsRoute,
		path: "$section",
		component: function Section() {
			const { section } = sectionRoute.useParams();
			return <SettingsSectionView sectionId={section} sections={sections} />;
		},
	});
	const router = createRouter({
		routeTree: rootRoute.addChildren([settingsRoute.addChildren([indexRoute, sectionRoute])]),
		history: createMemoryHistory({ initialEntries: [initial] }),
	});
	return render(
		<SdkProvider system={system}>
			<SidebarProvider>
				<RouterProvider router={router as never} />
			</SidebarProvider>
		</SdkProvider>,
	);
}

describe("SettingsSidebar", () => {
	it("shows back-to-app and no section nav when there are no sections", async () => {
		const { baseElement } = renderSettings([]);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("settings-page")).toBeVisible();
		const settingsPage = screen.getByTestId("settings-page").query();
		expect(settingsPage?.classList.contains("bg-muted")).toBe(true);
		expect(settingsPage?.classList.contains("border")).toBe(true);
		await expect.element(screen.getByTestId("settings-empty")).toBeVisible();
		await expect.element(screen.getByTestId("settings-back")).toBeVisible();
		await expect.element(screen.getByTestId("settings-section-nav")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("settings-search")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("settings-group-personal")).not.toBeInTheDocument();
	});

	it("lists sections in the siderail and switches the content pane", async () => {
		const sections = [
			makeSection({ id: "beta", title: "Beta", component: BetaPanel, priority: 10 }),
			makeSection(),
		];
		const { baseElement } = renderSettings(sections, "/settings/alpha");
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("settings-section-nav")).toBeVisible();
		await expect.element(screen.getByTestId("settings-group-personal")).toBeVisible();
		await expect.element(screen.getByTestId("alpha-panel")).toBeVisible();
		expect(screen.getByTestId("settings-section-alpha").element().className).toContain(
			"data-active:bg-muted",
		);

		await screen.getByTestId("settings-section-beta").click();
		await expect.element(screen.getByTestId("beta-panel")).toBeVisible();
	});

	it("filters the section list by search", async () => {
		const sections = [
			makeSection({ id: "beta", title: "Beta", component: BetaPanel, priority: 10 }),
			makeSection(),
		];
		const { baseElement } = renderSettings(sections, "/settings/alpha");
		const screen = page.elementLocator(baseElement);

		await screen.getByTestId("settings-search").fill("beta");
		await expect.element(screen.getByTestId("settings-section-beta")).toBeVisible();
		await expect.element(screen.getByTestId("settings-section-alpha")).not.toBeInTheDocument();
	});
});

describe("SettingsSectionView", () => {
	it("renders a not-found pane for an unknown section id", async () => {
		const { baseElement } = render(
			<SettingsSectionView sectionId="missing" sections={[makeSection()]} />,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("settings-section-not-found")).toBeVisible();
	});

	it("renders an unavailable pane for Electron-only sections in browser mode", async () => {
		const { baseElement } = render(
			<SettingsSectionView
				sectionId="alpha"
				sections={[makeSection({ browserSafe: false })]}
				desktopAvailable={false}
			/>,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("settings-section-unavailable")).toBeVisible();
	});
});
