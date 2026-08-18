import { cleanup, render } from "@testing-library/react";
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
) {
	const system = createAppFeatureSystem(api);
	setup?.(system);
	const rootRoute = createRootRoute({
		component: () => <AppSidebarLayout navEntries={navEntries}>content</AppSidebarLayout>,
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

	it("shows the Settings icon in the app bar when anonymous", async () => {
		renderLayout(fakeLocalApi({ status: "anonymous" }));

		await expect.element(page.getByRole("button", { name: "Settings" })).toBeVisible();
		await expect.element(page.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
		await expect
			.element(page.getByTestId("app-sidebar").getByTestId("nav-settings"))
			.not.toBeInTheDocument();
		await expect.element(page.getByTestId("settings-back")).not.toBeInTheDocument();
	});

	it("hides the Sign In button and app-bar Settings icon when authenticated", async () => {
		renderLayout(fakeLocalApi({ status: "authenticated", user: { username: "ada" } }));

		// Give the async auth delegate a tick to resolve to authenticated.
		await expect
			.element(page.getByRole("button", { name: "Account menu for ada" }))
			.toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: "Sign In" })).not.toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: "Settings" })).not.toBeInTheDocument();
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
	afterEach(cleanup);

	it("toggles the left nav open and closed", async () => {
		const { baseElement } = renderLayout(fakeLocalApi({ status: "anonymous" }));

		await expect
			.element(page.getByRole("button", { name: "Toggle navigation" }))
			.toBeInTheDocument();

		const sidebar = () => baseElement.querySelector('[data-slot="sidebar"]');
		expect(sidebar()?.getAttribute("data-state")).toBe("expanded");

		await page.getByRole("button", { name: "Toggle navigation" }).click();
		expect(sidebar()?.getAttribute("data-state")).toBe("collapsed");

		await page.getByRole("button", { name: "Toggle navigation" }).click();
		expect(sidebar()?.getAttribute("data-state")).toBe("expanded");
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
		await expect.element(page.getByRole("menuitem", { name: "Settings" })).toBeVisible();
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
		await expect.element(page.getByRole("button", { name: "Settings" })).toBeVisible();
		await expect.element(page.getByTestId("zone-sidebar")).not.toBeInTheDocument();
	});

	it("keeps Settings and Sign In right-aligned when header zones are empty", async () => {
		const { baseElement } = renderLayout(fakeLocalApi({ status: "anonymous" }), "/settings");

		await expect.element(page.getByRole("button", { name: "Sign In" })).toBeVisible();
		const header = baseElement.querySelector("header");
		expect(header).not.toBeNull();
		const login = page.getByRole("button", { name: "Sign In" }).element();
		const headerRect = header!.getBoundingClientRect();
		const loginRect = login.getBoundingClientRect();
		expect(loginRect.left).toBeGreaterThan(headerRect.width / 2);
		expect(headerRect.right - loginRect.right).toBeLessThan(48);
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
