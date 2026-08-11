import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import type { PluginPageProps } from "@anaconda-agentic-desktop/feature-sdk";

import { PluginPageView } from "./PluginPageView";

import type { PluginSidecarProps } from "@/features/built-in-sidecars";
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

function DemoSidecar({ search }: PluginSidecarProps) {
	return <div data-qa-id="demo-sidecar">sidecar search={JSON.stringify(search)}</div>;
}

function makePage(overrides: Partial<PluginPage> = {}): PluginPage {
	return {
		pluginId: "demo",
		path: "/plugins/demo",
		title: "Demo",
		sidecar: undefined,
		component: DemoPage,
		browserSafe: true,
		splat: "demo",
		...overrides,
	};
}

describe("PluginPageView", () => {
	it("mounts the plugin page component with path and search props", async () => {
		const { baseElement } = render(
			<PluginPageView
				splat="demo"
				search={{ filter: "open" }}
				pages={[makePage()]}
				desktopAvailable={false}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("demo-page")).toBeVisible();
		expect(screen.getByTestId("demo-page").query()?.textContent).toBe(
			'/plugins/demo search={"filter":"open"}',
		);
	});

	it("renders a not-found state for unknown paths", async () => {
		const { baseElement } = render(
			<PluginPageView splat="nope" search={{}} pages={[makePage()]} desktopAvailable={true} />,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("plugin-page-not-found")).toBeVisible();
	});

	it("treats an undefined splat as the root path", async () => {
		const { baseElement } = render(
			<PluginPageView splat={undefined} search={{}} pages={[]} desktopAvailable={true} />,
		);
		const screen = page.elementLocator(baseElement);
		await expect.element(screen.getByTestId("plugin-page-not-found")).toBeVisible();
	});

	it("renders an unavailable state for Electron-only pages in browser mode", async () => {
		const { baseElement } = render(
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
		const { baseElement } = render(
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

	it("mounts a route-requested host sidecar beside the plugin page", async () => {
		const { baseElement } = render(
			<PluginPageView
				splat="demo"
				search={{ notebookPath: "/project/analysis.ipynb" }}
				pages={[makePage({ sidecar: "demo" })]}
				desktopAvailable={true}
				sidecars={{ demo: DemoSidecar }}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("plugin-page-with-sidecar")).toBeVisible();
		await expect.element(screen.getByTestId("plugin-sidecar-demo")).toBeVisible();
		await expect
			.element(screen.getByTestId("demo-sidecar"))
			.toHaveTextContent('sidecar search={"notebookPath":"/project/analysis.ipynb"}');
	});

	it("keeps the page full-width when a requested sidecar is not installed", async () => {
		const { baseElement } = render(
			<PluginPageView
				splat="demo"
				search={{}}
				pages={[makePage({ sidecar: "missing" })]}
				desktopAvailable={true}
				sidecars={{}}
			/>,
		);
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByTestId("demo-page")).toBeVisible();
		expect(screen.getByTestId("plugin-page-with-sidecar").query()).toBeNull();
	});
});
