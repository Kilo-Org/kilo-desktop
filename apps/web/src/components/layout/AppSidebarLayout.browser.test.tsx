import { cleanup, fireEvent, render } from "@testing-library/react";
import {
	createMemoryHistory,
	createRootRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { AuthSession, LocalApi } from "@anaconda-agentic-desktop/contracts";

import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
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
			canPickDirectories: true,
			openExternal: async () => ({ opened: true }),
			copyText: async () => undefined,
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

function FakeNewChat() {
	return (
		<button type="button" data-qa-id="fake-new-chat">
			New Chat
		</button>
	);
}

function contributeFakeNewChat(system: ReturnType<typeof createAppFeatureSystem>) {
	system.getSdk("auth").contribute("sidebar", {
		id: "fake-new-chat",
		label: "Chats",
		priority: 10,
		component: FakeNewChat,
	});
}

describe("AppSidebarLayout login button", () => {
	afterEach(cleanup);

	it("shows Settings and Sign In in the sidebar footer when anonymous", async () => {
		renderLayout(fakeLocalApi({ status: "anonymous" }));

		const sidebar = page.getByTestId("app-sidebar");
		const accountDock = sidebar.getByTestId("anonymous-account-dock");
		await expect.element(accountDock).toBeVisible();
		expect(
			accountDock.element().contains(page.getByRole("button", { name: "Sign In" }).element()),
		).toBe(true);
		expect(accountDock.element().contains(sidebar.getByTestId("nav-settings").element())).toBe(
			true,
		);
		await expect.element(page.getByTestId("shell-anonymous-actions")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("settings-back")).not.toBeInTheDocument();
	});

	it("replaces the anonymous account dock with the authenticated account menu", async () => {
		renderLayout(fakeLocalApi({ status: "authenticated", user: { username: "ada" } }));

		// Give the async auth delegate a tick to resolve to authenticated.
		await expect.element(page.getByTestId("account-menu")).toBeInTheDocument();
		await expect.element(page.getByTestId("anonymous-account-dock")).not.toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: "Sign In" })).not.toBeInTheDocument();
		await expect.element(page.getByTestId("app-sidebar").getByTestId("nav-settings")).toBeVisible();
	});

	it("opens settings from the embedded gear without opening the account menu", async () => {
		renderLayout(fakeLocalApi({ status: "authenticated", user: { username: "ada" } }));

		await page.getByTestId("app-sidebar").getByTestId("nav-settings").click();

		await expect.element(page.getByTestId("settings-back")).toBeVisible();
		await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
	});

	it("calls auth.login on click", async () => {
		const login = vi.fn(async (): Promise<AuthSession> => ({ status: "anonymous" }));
		renderLayout(fakeLocalApi({ status: "anonymous" }, { login }));

		await page.getByRole("button", { name: "Sign In" }).click();

		expect(login).toHaveBeenCalledTimes(1);
	});

	it("tracks LOGGED_IN after a successful login", async () => {
		const login = vi.fn(async (): Promise<AuthSession> => ({
			status: "authenticated",
			user: { username: "ada" },
		}));
		const track = vi.fn(async () => undefined);
		renderLayout(fakeLocalApi({ status: "anonymous" }, { login }, apiWithTrack(track)));

		await page.getByRole("button", { name: "Sign In" }).click();

		await vi.waitFor(() => {
			expect(track).toHaveBeenCalledWith(expect.objectContaining({ event: "LOGGED_IN" }));
		});
	});

	it("does not track LOGGED_IN when login fails", async () => {
		const login = vi.fn(async (): Promise<AuthSession> => ({ status: "error", reason: "nope" }));
		const track = vi.fn(async () => undefined);
		renderLayout(fakeLocalApi({ status: "anonymous" }, { login }, apiWithTrack(track)));

		await page.getByRole("button", { name: "Sign In" }).click();

		await vi.waitFor(() => {
			expect(login).toHaveBeenCalledTimes(1);
		});
		expect(track).not.toHaveBeenCalledWith(expect.objectContaining({ event: "LOGGED_IN" }));
	});

	it("tracks PAGE_VISIT for the initial route on mount", async () => {
		const track = vi.fn(async () => undefined);
		renderLayout(fakeLocalApi({ status: "anonymous" }, {}, apiWithTrack(track)));

		await vi.waitFor(() => {
			expect(track).toHaveBeenCalledWith({ event: "PAGE_VISIT", data: { path: "/" } });
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

describe("AppSidebarLayout account menu", () => {
	afterEach(cleanup);

	it("shows account details and logs out", async () => {
		const logout = vi.fn(async (): Promise<AuthSession> => ({ status: "anonymous" }));
		const track = vi.fn(async () => undefined);
		renderLayout(
			fakeLocalApi(
				{
					status: "authenticated",
					user: {
						firstName: "Ada",
						lastName: "Lovelace",
						username: "ada",
						email: "ada@example.com",
					},
				},
				{ logout },
				apiWithTrack(track),
			),
		);

		await page.getByRole("button", { name: "Account menu for Ada Lovelace" }).click();

		// Name and email render in both the footer trigger and the open menu.
		const menu = page.getByRole("menu");
		await expect.element(menu.getByText("Ada Lovelace")).toBeVisible();
		await expect.element(menu.getByText("ada@example.com")).toBeVisible();
		await expect.element(page.getByRole("menuitem", { name: "Settings" })).not.toBeInTheDocument();
		await page.getByRole("menuitem", { name: "Log out" }).click();

		expect(logout).toHaveBeenCalledTimes(1);
		await vi.waitFor(() => {
			expect(track).toHaveBeenCalledWith(expect.objectContaining({ event: "LOGGED_OUT" }));
		});
	});

	it("does not track LOGGED_OUT when logout fails", async () => {
		const logout = vi.fn(async (): Promise<AuthSession> => ({ status: "error", reason: "nope" }));
		const track = vi.fn(async () => undefined);
		renderLayout(
			fakeLocalApi(
				{ status: "authenticated", user: { username: "ada" } },
				{ logout },
				apiWithTrack(track),
			),
		);

		await page.getByRole("button", { name: "Account menu for ada" }).click();
		await page.getByRole("menuitem", { name: "Log out" }).click();

		await vi.waitFor(() => {
			expect(logout).toHaveBeenCalledTimes(1);
		});
		expect(track).not.toHaveBeenCalledWith(expect.objectContaining({ event: "LOGGED_OUT" }));
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

	it("keeps Settings and Sign In in the sidebar footer under the shell-owned page header", async () => {
		renderLayout(fakeLocalApi({ status: "anonymous" }), "/settings");

		const sidebar = page.getByTestId("app-sidebar");
		const accountDock = sidebar.getByTestId("anonymous-account-dock");
		await expect.element(accountDock).toBeVisible();
		const login = page.getByRole("button", { name: "Sign In" }).element();
		const settings = sidebar.getByTestId("nav-settings").element();
		expect(accountDock.element().contains(settings)).toBe(true);
		expect(accountDock.element().contains(login)).toBe(true);
		await expect.element(page.getByTestId("shell-anonymous-actions")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("shell-page-header")).toBeVisible();
		await expect.element(page.getByRole("heading", { name: "Settings" })).toBeVisible();
	});

	it("aligns Back to app with the first sidebar zone row", async () => {
		const api = fakeLocalApi({ status: "anonymous" });
		renderLayout(api, "/", contributeFakeNewChat);
		await expect.element(page.getByTestId("fake-new-chat")).toBeVisible();
		const chatTop = page.getByTestId("fake-new-chat").element().getBoundingClientRect().top;
		cleanup();

		renderLayout(api, "/settings", contributeFakeNewChat);
		await expect.element(page.getByTestId("settings-back")).toBeVisible();
		const backTop = page.getByTestId("settings-back").element().getBoundingClientRect().top;

		expect(backTop).toBe(chatTop);
	});
});
