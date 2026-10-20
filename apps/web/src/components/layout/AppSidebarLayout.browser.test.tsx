import { cleanup, fireEvent, render } from "@testing-library/react";
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { AuthSession, LocalApi } from "@kilo-desktop/contracts";

import { SdkProvider } from "@kilo-desktop/sdk-react";
import type { PluginNavEntry } from "@/features/plugin-nav";
import type { PluginPage } from "@/features/plugin-pages";
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { createAppFeatureSystem } from "@/platform/featureSystem";

import { AppSidebarLayout } from "./AppSidebarLayout";

const flaggedNav: readonly PluginNavEntry[] = [
	{
		pluginId: "todos",
		to: "/plugins/todos",
		label: "Todos",
		icon: undefined,
		iconComponent: undefined,
		priority: 1,
		splat: "todos",
		navQaId: "nav-todos",
		featureFlag: "todo-feature",
	},
	{
		pluginId: "environments",
		to: "/plugins/environments",
		label: "Environments",
		icon: undefined,
		iconComponent: undefined,
		priority: 1,
		splat: "environments",
		navQaId: "nav-environments",
		featureFlag: "environments-feature",
	},
];

type AuthOverrides = Partial<LocalApi["auth"]>;

function fakeLocalApi(
	session: AuthSession,
	auth: AuthOverrides = {},
	overrides: Partial<LocalApi> = {},
): LocalApi {
	const base = createBrowserLocalApi();
	return {
		...base,
		theme: {
			sync: async () => undefined,
		},
		shell: {
			...base.shell,
			canPickDirectories: true,
			openExternal: async () => ({ opened: true }),
			copyText: async () => undefined,
			showItemInFolder: async () => ({ revealed: true }),
			showOpenDialog: async () => ({ canceled: true, paths: [] }),
			getPathForFile: () => null,
		},
		auth: {
			getSession: async () => session,
			refresh: async () => session,
			login: async () => session,
			logout: async () => ({ status: "anonymous" }),
			onChanged: () => () => undefined,
			...auth,
		},
		...overrides,
	};
}

function apiWithFlags(flags: Record<string, unknown>): Partial<LocalApi> {
	return {
		featureFlags: {
			getAllFlags: async () => flags,
			onChanged: () => () => undefined,
		},
	};
}

function apiWithTrack(track: LocalApi["telemetry"]["track"]): Partial<LocalApi> {
	return { telemetry: { track } };
}

function renderLayout(
	api: LocalApi,
	path = "/",
	setup?: (system: ReturnType<typeof createAppFeatureSystem>) => void,
	navEntries: readonly PluginNavEntry[] = [],
	pages: readonly PluginPage[] = [],
) {
	const system = createAppFeatureSystem(api);
	setup?.(system);
	const rootRoute = createRootRoute({
		component: () => (
			<AppSidebarLayout navEntries={navEntries} pages={pages}>
				content
			</AppSidebarLayout>
		),
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: [path] }),
	});
	return render(
		<SdkProvider system={system}>
			<RouterProvider router={router as never} />
		</SdkProvider>,
	);
}

function DemoHeaderLeading() {
	return <span data-qa-id="demo-header-leading">Demo breadcrumb</span>;
}

function DemoHeaderActions() {
	return (
		<button type="button" data-qa-id="demo-header-actions">
			Route action
		</button>
	);
}

function GlobalHeaderAction() {
	return (
		<button type="button" data-qa-id="global-header-action">
			Global action
		</button>
	);
}

const demoPages: readonly PluginPage[] = [
	{
		pluginId: "demo",
		path: "/plugins/demo",
		title: "Demo",
		surface: "default",
		component: () => null,
		headerLeading: DemoHeaderLeading,
		headerActions: DemoHeaderActions,
		browserSafe: true,
		splat: "demo",
	},
];

describe("AppSidebarLayout page header", () => {
	afterEach(cleanup);

	it("owns the page header and composes route and global plugin actions", async () => {
		renderLayout(
			fakeLocalApi({ status: "anonymous" }),
			"/plugins/demo",
			(system) => {
				system.getSdk("demo").contribute("page-header-actions", {
					id: "global-action",
					label: "Global action",
					component: GlobalHeaderAction,
				});
			},
			[],
			demoPages,
		);

		const header = page.getByTestId("shell-page-header");
		await expect.element(header).toBeVisible();
		await expect.element(header.getByTestId("demo-header-leading")).toBeVisible();
		await expect.element(header.getByTestId("demo-header-actions")).toBeVisible();
		await expect.element(header.getByTestId("global-header-action")).toBeVisible();
	});

	it("uses shell route metadata for a page title", async () => {
		renderLayout(
			fakeLocalApi({ status: "anonymous" }),
			"/plugins/demo",
			undefined,
			[],
			[{ ...demoPages[0]!, headerLeading: undefined, headerActions: undefined }],
		);

		await expect.element(page.getByRole("heading", { name: "Demo" })).toBeVisible();
	});
});

function FakeAccountDock() {
	return (
		<button type="button" data-qa-id="fake-account-dock">
			Fake account
		</button>
	);
}

function contributeFakeAccountDock(system: ReturnType<typeof createAppFeatureSystem>) {
	system.getSdk("demo").contribute("sidebar-account", {
		id: "fake-account-dock",
		label: "Account",
		priority: 10,
		component: FakeAccountDock,
	});
}

describe("AppSidebarLayout account dock", () => {
	afterEach(cleanup);

	it("renders sidebar-account zone contributions in the footer next to the settings gear", async () => {
		renderLayout(fakeLocalApi({ status: "anonymous" }), "/", contributeFakeAccountDock);

		const sidebar = page.getByTestId("app-sidebar");
		await expect.element(page.getByTestId("fake-account-dock")).toBeVisible();
		await expect.element(sidebar.getByTestId("nav-settings")).toBeVisible();
		const accountBox = page.getByTestId("fake-account-dock").element().getBoundingClientRect();
		const settingsBox = sidebar.getByTestId("nav-settings").element().getBoundingClientRect();
		expect(accountBox.right).toBeLessThanOrEqual(settingsBox.left);
		await expect.element(page.getByTestId("shell-anonymous-actions")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("settings-back")).not.toBeInTheDocument();
	});

	it("keeps the settings gear in the footer when no account is contributed", async () => {
		renderLayout(fakeLocalApi({ status: "anonymous" }));

		const sidebar = page.getByTestId("app-sidebar");
		await expect.element(sidebar.getByTestId("nav-settings")).toBeVisible();
		// The zone outlet renders nothing while no plugin contributes a dock.
		expect(document.querySelector('[data-qa-id="zone-sidebar-account"]')).toBeNull();
		await expect.element(page.getByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
	});

	it("opens settings from the footer gear", async () => {
		renderLayout(fakeLocalApi({ status: "anonymous" }));

		await page.getByTestId("app-sidebar").getByTestId("nav-settings").click();

		await expect.element(page.getByTestId("settings-back")).toBeVisible();
	});

	it("closes settings from the footer gear", async () => {
		renderLayout(fakeLocalApi({ status: "anonymous" }), "/settings");

		await page.getByTestId("app-sidebar").getByTestId("nav-settings").click();

		await expect.element(page.getByTestId("settings-back")).not.toBeInTheDocument();
	});

	it("tracks Page Visit for the initial route on mount", async () => {
		const track = vi.fn(async () => undefined);
		renderLayout(fakeLocalApi({ status: "anonymous" }, {}, apiWithTrack(track)));

		await vi.waitFor(() => {
			expect(track).toHaveBeenCalledWith({ event: "Page Visit", data: { path: "/" } });
		});
	});
});

describe("AppSidebarLayout nav toggle", () => {
	afterEach(() => {
		cleanup();
		localStorage.removeItem("shell:sidebar-width");
	});

	it("toggles the left nav open and closed", async () => {
		const { baseElement } = renderLayout(fakeLocalApi({ status: "anonymous" }));

		const toggle = page.getByRole("button", { name: "Toggle navigation" });
		await expect.element(toggle).toBeInTheDocument();

		const sidebar = () => baseElement.querySelector('[data-slot="sidebar"]');
		expect(sidebar()?.getAttribute("data-state")).toBe("expanded");

		await page.getByRole("button", { name: "Toggle navigation" }).click();
		expect(sidebar()?.getAttribute("data-state")).toBe("collapsed");

		await page.getByRole("button", { name: "Toggle navigation" }).click();
		expect(sidebar()?.getAttribute("data-state")).toBe("expanded");
	});

	it("keeps the nav toggle clear of draggable title-bar regions", async () => {
		const { baseElement } = renderLayout(fakeLocalApi({ status: "anonymous" }));

		const toggle = page.getByRole("button", { name: "Toggle navigation" });
		await expect.element(toggle).toBeInTheDocument();
		const sidebarGap = baseElement.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
		expect(sidebarGap).not.toBeNull();
		const expectToggleOutsideDragRegions = () => {
			const toggleRect = toggle.element().getBoundingClientRect();
			const toggleCenter = {
				x: toggleRect.left + toggleRect.width / 2,
				y: toggleRect.top + toggleRect.height / 2,
			};
			const overlappingDragRegions = Array.from(
				baseElement.querySelectorAll<HTMLElement>(".drag-region"),
			).filter((region) => {
				const regionRect = region.getBoundingClientRect();
				return (
					toggleCenter.x >= regionRect.left &&
					toggleCenter.x <= regionRect.right &&
					toggleCenter.y >= regionRect.top &&
					toggleCenter.y <= regionRect.bottom
				);
			});

			expect(overlappingDragRegions).toHaveLength(0);
		};

		expectToggleOutsideDragRegions();
		await toggle.click();
		await vi.waitFor(() => {
			expect(sidebarGap?.getBoundingClientRect().width).toBe(0);
		});
		expectToggleOutsideDragRegions();
	});

	it("shows a beta badge beside the nav toggle, clear of title-bar content", async () => {
		const { baseElement } = renderLayout(
			fakeLocalApi({ status: "anonymous" }),
			"/plugins/demo",
			undefined,
			[],
			[{ ...demoPages[0]!, headerLeading: undefined, headerActions: undefined }],
		);

		const toggle = page.getByRole("button", { name: "Toggle navigation" });
		const badge = page.getByTestId("sidebar-beta-badge");
		await expect.element(badge).toHaveTextContent("Beta");
		const sidebarGap = baseElement.querySelector<HTMLElement>('[data-slot="sidebar-gap"]');
		const expectBadgeBesideToggleAndUncovered = () => {
			const toggleRect = toggle.element().getBoundingClientRect();
			const badgeRect = badge.element().getBoundingClientRect();
			expect(badgeRect.left).toBeGreaterThanOrEqual(toggleRect.right);
			const regionsStartingUnderBadge = Array.from(
				baseElement.querySelectorAll<HTMLElement>(".drag-region"),
			).filter((region) => {
				const regionRect = region.getBoundingClientRect();
				return regionRect.left < badgeRect.right && regionRect.right > badgeRect.right;
			});
			expect(regionsStartingUnderBadge).toHaveLength(0);
		};

		expectBadgeBesideToggleAndUncovered();
		await toggle.click();
		await vi.waitFor(() => {
			expect(sidebarGap?.getBoundingClientRect().width).toBe(0);
		});
		expectBadgeBesideToggleAndUncovered();
		const headingRect = page
			.getByRole("heading", { name: "Demo" })
			.element()
			.getBoundingClientRect();
		expect(headingRect.left).toBeGreaterThanOrEqual(badge.element().getBoundingClientRect().right);
	});

	it("reveals the collapsed nav transiently without moving the page while entering it", async () => {
		const { baseElement } = renderLayout(fakeLocalApi({ status: "anonymous" }));
		const toggle = page.getByRole("button", { name: "Toggle navigation" });
		const sidebar = () => baseElement.querySelector('[data-slot="sidebar"]');
		const panelLayer = () =>
			baseElement.querySelector('[data-slot="sidebar-container"]') as HTMLElement;

		await toggle.click();
		const inset = baseElement.querySelector('[data-qa-id="shell-main"]')!.parentElement!;
		expect(sidebar()?.getAttribute("data-state")).toBe("collapsed");
		await vi.waitFor(() => {
			expect(inset.getBoundingClientRect().left).toBeLessThan(1);
		});

		fireEvent.pointerEnter(toggle.element());
		expect(sidebar()?.getAttribute("data-transient")).toBe("true");
		expect(sidebar()?.getAttribute("data-state")).toBe("collapsed");
		expect(inset.getBoundingClientRect().left).toBeLessThan(1);

		const panel = baseElement.querySelector('[data-slot="sidebar-inner"]');
		fireEvent.pointerLeave(toggle.element(), { relatedTarget: document.body });
		expect(sidebar()?.getAttribute("data-transient")).toBe("true");

		fireEvent.pointerEnter(panel!);
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(sidebar()?.getAttribute("data-transient")).toBe("true");
		expect(inset.getBoundingClientRect().left).toBeLessThan(1);
		expect(Number(getComputedStyle(panelLayer()).zIndex)).toBeGreaterThan(10);
		expect(getComputedStyle(panelLayer()).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");

		fireEvent.pointerLeave(panel!, { relatedTarget: document.body });
		await vi.waitFor(() => {
			expect(sidebar()?.getAttribute("data-transient")).toBeNull();
			expect(inset.getBoundingClientRect().left).toBeLessThan(1);
		});
		expect(sidebar()?.getAttribute("data-state")).toBe("collapsed");
	});

	it("dismisses the transient nav after a navigation selection without expanding it", async () => {
		const { baseElement } = renderLayout(fakeLocalApi({ status: "anonymous" }));
		const toggle = page.getByRole("button", { name: "Toggle navigation" });
		const sidebar = () => baseElement.querySelector('[data-slot="sidebar"]');

		await toggle.click();
		fireEvent.pointerEnter(toggle.element());
		expect(sidebar()?.getAttribute("data-transient")).toBe("true");

		await page.getByTestId("nav-settings").click();

		expect(sidebar()?.getAttribute("data-transient")).toBeNull();
		expect(sidebar()?.getAttribute("data-state")).toBe("collapsed");
		await expect.element(page.getByTestId("settings-back")).toBeVisible();
	});

	it("resizes the left nav when the rail is dragged", async () => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
		const { baseElement } = renderLayout(fakeLocalApi({ status: "anonymous" }));

		const rail = page.getByTestId("sidebar-resize");
		await expect.element(rail).toBeInTheDocument();
		expect(getComputedStyle(rail.element()).cursor).toBe("col-resize");

		const wrapper = () =>
			baseElement.querySelector('[data-slot="sidebar-wrapper"]') as HTMLElement | null;
		expect(parseFloat(wrapper()?.style.getPropertyValue("--sidebar-width") ?? "")).toBe(256);

		const handle = rail.element();
		fireEvent.pointerDown(handle, { button: 0, clientX: 256, pointerId: 1 });
		fireEvent(
			window,
			new PointerEvent("pointermove", { bubbles: true, clientX: 336, pointerId: 1 }),
		);
		fireEvent(window, new PointerEvent("pointerup", { bubbles: true, clientX: 336, pointerId: 1 }));

		expect(parseFloat(wrapper()?.style.getPropertyValue("--sidebar-width") ?? "")).toBe(336);
		expect(localStorage.getItem("shell:sidebar-width")).toBe("336");
		expect(baseElement.querySelector('[data-slot="sidebar"]')?.getAttribute("data-state")).toBe(
			"expanded",
		);
	});

	it("restores the last dragged sidebar width on remount", async () => {
		Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
		localStorage.setItem("shell:sidebar-width", "320");
		const { baseElement } = renderLayout(fakeLocalApi({ status: "anonymous" }));

		await expect.element(page.getByTestId("sidebar-resize")).toBeInTheDocument();
		const wrapper = baseElement.querySelector(
			'[data-slot="sidebar-wrapper"]',
		) as HTMLElement | null;
		expect(parseFloat(wrapper?.style.getPropertyValue("--sidebar-width") ?? "")).toBe(320);
	});
});

describe("AppSidebarLayout plugin nav flag gating", () => {
	afterEach(cleanup);

	it("hides a flag-gated plugin nav entry when the flag is off", async () => {
		renderLayout(
			fakeLocalApi(
				{ status: "anonymous" },
				{},
				apiWithFlags({ "environments-feature": false, "todo-feature": true }),
			),
			"/",
			undefined,
			flaggedNav,
		);

		// Todos declares `featureFlag: "todo-feature"` — visible when the
		// flag map carries a truthy value for that key.
		await expect.element(page.getByTestId("nav-todos")).toBeInTheDocument();
		// Environments declares `featureFlag: "environments-feature"` in
		// plugin.json → hidden when the flag map lacks the truthy value.
		await expect.element(page.getByTestId("nav-environments")).not.toBeInTheDocument();
	});

	it("hides a flag-gated plugin nav entry when the flag is missing entirely", async () => {
		const { baseElement } = renderLayout(
			fakeLocalApi({ status: "anonymous" }, {}, apiWithFlags({})),
			"/",
			undefined,
			flaggedNav,
		);

		// Both nav entries carry a `featureFlag` now, so an empty flag map
		// hides them both.
		await expect.element(page.getByTestId("nav-environments")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("nav-todos")).not.toBeInTheDocument();
		// Empty group still has SidebarGroup padding — omit the chrome entirely.
		expect(baseElement.querySelector('[data-sidebar="group"]')).toBeNull();
	});

	it("shows the flag-gated plugin nav entry when the flag is on", async () => {
		const { baseElement } = renderLayout(
			fakeLocalApi(
				{ status: "anonymous" },
				{},
				apiWithFlags({ "environments-feature": true, "todo-feature": true }),
			),
			"/",
			undefined,
			flaggedNav,
		);

		await expect.element(page.getByTestId("nav-environments")).toBeInTheDocument();
		await expect.element(page.getByTestId("nav-todos")).toBeInTheDocument();
		expect(baseElement.querySelector('[data-sidebar="group"]')).not.toBeNull();
	});
});

describe("AppSidebarLayout settings takeover", () => {
	afterEach(cleanup);

	it("replaces plugin nav with the settings siderail on /settings", async () => {
		renderLayout(fakeLocalApi({ status: "anonymous" }), "/settings");

		await expect.element(page.getByTestId("settings-back")).toBeVisible();
		await expect.element(page.getByTestId("app-sidebar").getByTestId("nav-settings")).toBeVisible();
		await expect
			.element(page.getByTestId("app-sidebar-primary"))
			.toHaveAttribute("aria-hidden", "true");
	});

	it("keeps the account dock zone in the sidebar footer under the shell-owned page header", async () => {
		renderLayout(fakeLocalApi({ status: "anonymous" }), "/settings", contributeFakeAccountDock);

		const sidebar = page.getByTestId("app-sidebar");
		await expect.element(page.getByTestId("fake-account-dock")).toBeVisible();
		expect(
			sidebar
				.getByTestId("zone-sidebar-account")
				.element()
				.contains(page.getByTestId("fake-account-dock").element()),
		).toBe(true);
		await expect.element(sidebar.getByTestId("nav-settings")).toBeVisible();
		await expect.element(page.getByTestId("shell-anonymous-actions")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("shell-page-header")).toBeVisible();
		await expect.element(page.getByRole("heading", { name: "Settings" })).toBeVisible();
	});
});
