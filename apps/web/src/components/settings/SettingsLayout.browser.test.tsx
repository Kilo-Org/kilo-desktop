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
import { page, userEvent } from "vitest/browser";

import { SdkProvider, SettingsPageHeader } from "@kilo-desktop/sdk-react";
import { SidebarProvider } from "@kilo-desktop/ui/components/sidebar";
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { HOME_PLUGIN_SPLAT } from "@/features/home-route";
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
		category: "General",
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
	const view = render(
		<SdkProvider system={system}>
			<SidebarProvider>
				<RouterProvider router={router as never} />
			</SidebarProvider>
		</SdkProvider>,
	);
	return Object.assign(view, { router });
}

describe("SettingsSidebar", () => {
	it("shows back-to-app and no section nav when there are no sections", async () => {
		const { baseElement } = renderSettings([]);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("settings-page")).toBeVisible();
		await expect.element(screen.getByTestId("settings-empty")).toBeVisible();
		await expect.element(screen.getByTestId("settings-back")).toBeVisible();
		await expect.element(screen.getByTestId("settings-section-nav")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("settings-search")).not.toBeInTheDocument();
		await expect.element(screen.getByTestId("settings-group-general")).not.toBeInTheDocument();
		expect(
			getComputedStyle(screen.getByTestId("settings-page").element().firstElementChild!)
				.scrollbarGutter,
		).toBe("stable");
	});

	it("lists sections in the siderail and switches the content pane", async () => {
		const sections = [
			makeSection({ id: "beta", title: "Beta", component: BetaPanel, priority: 10 }),
			makeSection(),
		];
		const { baseElement } = renderSettings(sections, "/settings/alpha");
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("settings-section-nav")).toBeVisible();
		await expect.element(screen.getByTestId("settings-group-general")).toBeVisible();
		await expect.element(screen.getByTestId("alpha-panel")).toBeVisible();
		expect(screen.getByTestId("settings-section-alpha").element()).toHaveAttribute("data-active");

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

	it("groups sections by category", async () => {
		const sections = [
			makeSection(),
			makeSection({
				id: "local-model-server",
				title: "Local Model Server",
				category: "AI",
				component: BetaPanel,
			}),
		];
		const { baseElement } = renderSettings(sections);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("settings-group-general")).toHaveTextContent("General");
		await expect.element(screen.getByTestId("settings-group-ai")).toHaveTextContent("AI");
		await expect.element(screen.getByTestId("settings-section-local-model-server")).toBeVisible();
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

	it("defaults a section's page header to its entry title and description", async () => {
		function PanelWithAction() {
			return (
				<div data-qa-id="alpha-panel">
					<SettingsPageHeader actions={<button type="button">Refresh</button>} />
					Alpha panel
				</div>
			);
		}
		const { baseElement } = render(
			<SettingsSectionView
				sectionId="alpha"
				sections={[makeSection({ description: "Alpha settings.", component: PanelWithAction })]}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByRole("heading", { level: 1, name: "Alpha" }))
			.toHaveAttribute("data-qa-id", "settings-section-heading");
		await expect.element(screen.getByText("Alpha settings.")).toBeVisible();
		await expect
			.element(
				screen.getByTestId("settings-section-actions").getByRole("button", { name: "Refresh" }),
			)
			.toBeVisible();
	});

	it("lets a section replace the page title and subtitle", async () => {
		function PanelWithHeading() {
			return (
				<div data-qa-id="alpha-panel">
					<SettingsPageHeader
						title="dev"
						description="/opt/conda/envs/dev"
						titleQaId="env-name"
						leading={
							<button type="button" data-qa-id="env-back">
								Back
							</button>
						}
					>
						<span data-qa-id="env-badge">Python 3.12</span>
					</SettingsPageHeader>
					Alpha panel
				</div>
			);
		}
		const { baseElement } = render(
			<SettingsSectionView
				sectionId="alpha"
				sections={[makeSection({ description: "Alpha settings.", component: PanelWithHeading })]}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect
			.element(screen.getByRole("heading", { level: 1, name: "dev" }))
			.toHaveAttribute("data-qa-id", "env-name");
		await expect.element(screen.getByText("/opt/conda/envs/dev")).toBeVisible();
		await expect.element(screen.getByTestId("env-back")).toBeVisible();
		await expect.element(screen.getByTestId("env-badge")).toBeVisible();
		await expect.element(screen.getByText("Alpha settings.")).not.toBeInTheDocument();
	});
});

describe("SettingsLayout", () => {
	it("keeps Esc while the search field has text, and leaves Settings once it is empty", async () => {
		const { baseElement, router } = renderSettings([makeSection()], "/settings/alpha");
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("alpha-panel")).toBeVisible();

		await screen.getByTestId("settings-search").click();
		await userEvent.keyboard("alp{Escape}");
		expect(router.state.location.pathname).toBe("/settings/alpha");

		await userEvent.keyboard("{Backspace}{Backspace}{Backspace}{Escape}");
		await expect.poll(() => router.state.location.pathname).toBe(`/plugins/${HOME_PLUGIN_SPLAT}`);
	});
});
