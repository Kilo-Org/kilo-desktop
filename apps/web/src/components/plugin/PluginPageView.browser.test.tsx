import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { PluginPageProps } from "@kilo-desktop/feature-sdk";
import { SidebarProvider } from "@kilo-desktop/ui/components/sidebar";

import { PluginPageView } from "./PluginPageView";

import type { PluginPage } from "@/features/plugin-pages";

afterEach(() => {
	cleanup();
});

function DemoPage({ path, search }: PluginPageProps) {
	return (
		<div data-qa-id="demo-page">
			{path} search={JSON.stringify(search)}
		</div>
	);
}

function makePage(overrides: Partial<PluginPage> = {}): PluginPage {
	return {
		pluginId: "demo",
		path: "/plugins/demo",
		title: "Demo",
		surface: "default",
		component: DemoPage,
		browserSafe: true,
		splat: "demo",
		...overrides,
	};
}

function renderPageView(view: React.ReactNode) {
	return render(<SidebarProvider>{view}</SidebarProvider>);
}

describe("PluginPageView", () => {
	it("mounts the plugin page component with path and search props", async () => {
		const { baseElement } = renderPageView(
			<PluginPageView
				splat="demo"
				search={{ filter: "open" }}
				pages={[makePage()]}
				desktopAvailable={false}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("demo-page")).toBeVisible();
		await expect
			.element(screen.getByTestId("plugin-page-surface"))
			.toHaveAttribute("data-surface", "default");
		expect(screen.getByTestId("demo-page").query()?.textContent).toBe(
			'/plugins/demo search={"filter":"open"}',
		);
	});

	it("allows split-pane pages to opt out of the default shell surface", async () => {
		const { baseElement } = renderPageView(
			<PluginPageView
				splat="demo"
				search={{}}
				pages={[makePage({ surface: "transparent" })]}
				desktopAvailable={false}
			/>,
		);
		const screen = page.elementLocator(baseElement);
		const surface = screen.getByTestId("plugin-page-surface");

		await expect.element(surface).toHaveAttribute("data-surface", "transparent");
		expect(surface.query()?.classList.contains("bg-transparent")).toBe(true);
		expect(surface.query()?.classList.contains("bg-muted")).toBe(false);
	});

	it("renders a not-found state for unknown paths", async () => {
		const { baseElement } = renderPageView(
			<PluginPageView splat="nope" search={{}} pages={[makePage()]} desktopAvailable={true} />,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("plugin-page-not-found")).toBeVisible();
	});

	it("treats an undefined splat as the root path", async () => {
		const { baseElement } = renderPageView(
			<PluginPageView splat={undefined} search={{}} pages={[]} desktopAvailable={true} />,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("plugin-page-not-found")).toBeVisible();
	});

	it("renders an unavailable state for Electron-only pages in browser mode", async () => {
		const { baseElement } = renderPageView(
			<PluginPageView
				splat="demo"
				search={{}}
				pages={[makePage({ browserSafe: false })]}
				desktopAvailable={false}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("plugin-page-unavailable")).toBeVisible();
		expect(screen.getByTestId("demo-page").query()).toBeNull();
	});

	it("mounts Electron-only pages when the desktop bridge is available", async () => {
		const { baseElement } = renderPageView(
			<PluginPageView
				splat="demo"
				search={{}}
				pages={[makePage({ browserSafe: false })]}
				desktopAvailable={true}
			/>,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("demo-page")).toBeVisible();
	});
});
