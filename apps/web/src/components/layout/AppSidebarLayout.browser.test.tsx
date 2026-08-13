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
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { createAppFeatureSystem } from "@/platform/featureSystem";

import { AppSidebarLayout } from "./AppSidebarLayout";

type AuthOverrides = Partial<LocalApi["auth"]>;

function fakeLocalApi(
	session: AuthSession,
	auth: AuthOverrides = {},
	overrides: Partial<LocalApi> = {},
): LocalApi {
	return {
		...createBrowserLocalApi(),
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

function renderLayout(
	api: LocalApi,
	path = "/",
	setup?: (system: ReturnType<typeof createAppFeatureSystem>) => void,
) {
	const system = createAppFeatureSystem(api);
	setup?.(system);
	const rootRoute = createRootRoute({
		component: () => <AppSidebarLayout>content</AppSidebarLayout>,
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
		await expect.element(page.getByRole("button", { name: "Log in" })).toBeInTheDocument();
		await expect
			.element(page.getByTestId("app-sidebar").getByTestId("nav-settings"))
			.not.toBeInTheDocument();
		await expect.element(page.getByTestId("settings-back")).not.toBeInTheDocument();
	});

	it("hides the Log in button and app-bar Settings icon when authenticated", async () => {
		renderLayout(fakeLocalApi({ status: "authenticated", user: { username: "ada" } }));

		// Give the async auth delegate a tick to resolve to authenticated.
		await expect
			.element(page.getByRole("button", { name: "Account menu for ada" }))
			.toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: "Log in" })).not.toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: "Settings" })).not.toBeInTheDocument();
	});

	it("calls auth.login on click", async () => {
		const login = vi.fn(async (): Promise<AuthSession> => ({ status: "anonymous" }));
		renderLayout(fakeLocalApi({ status: "anonymous" }, { login }));

		await page.getByRole("button", { name: "Log in" }).click();

		expect(login).toHaveBeenCalledTimes(1);
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
		);

		// Todos declares `featureFlag: "todo-feature"` — visible when the
		// flag map carries a truthy value for that key.
		await expect.element(page.getByTestId("nav-todos")).toBeInTheDocument();
		// Environments declares `featureFlag: "environments-feature"` in
		// plugin.json → hidden when the flag map lacks the truthy value.
		await expect.element(page.getByTestId("nav-environments")).not.toBeInTheDocument();
	});

	it("hides a flag-gated plugin nav entry when the flag is missing entirely", async () => {
		renderLayout(fakeLocalApi({ status: "anonymous" }, {}, apiWithFlags({})));

		// Both nav entries carry a `featureFlag` now, so an empty flag map
		// hides them both.
		await expect.element(page.getByTestId("nav-environments")).not.toBeInTheDocument();
		await expect.element(page.getByTestId("nav-todos")).not.toBeInTheDocument();
	});

	it("shows the flag-gated plugin nav entry when the flag is on", async () => {
		renderLayout(
			fakeLocalApi(
				{ status: "anonymous" },
				{},
				apiWithFlags({ "environments-feature": true, "todo-feature": true }),
			),
		);

		await expect.element(page.getByTestId("nav-environments")).toBeInTheDocument();
		await expect.element(page.getByTestId("nav-todos")).toBeInTheDocument();
	});
});

describe("AppSidebarLayout account menu", () => {
	afterEach(cleanup);

	it("shows account details and logs out", async () => {
		const logout = vi.fn(async (): Promise<AuthSession> => ({ status: "anonymous" }));
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
