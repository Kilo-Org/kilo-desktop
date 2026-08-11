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

function fakeLocalApi(session: AuthSession, auth: AuthOverrides = {}): LocalApi {
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
	};
}

function renderLayout(api: LocalApi) {
	const system = createAppFeatureSystem(api);
	const rootRoute = createRootRoute({
		component: () => <AppSidebarLayout>content</AppSidebarLayout>,
	});
	const router = createRouter({
		routeTree: rootRoute,
		history: createMemoryHistory({ initialEntries: ["/"] }),
	});
	return render(
		<SdkProvider system={system}>
			<RouterProvider router={router as never} />
		</SdkProvider>,
	);
}

describe("AppSidebarLayout login button", () => {
	afterEach(cleanup);

	it("shows the Log in button when anonymous", async () => {
		renderLayout(fakeLocalApi({ status: "anonymous" }));

		await expect.element(page.getByRole("button", { name: "Log in" })).toBeInTheDocument();
	});

	it("hides the Log in button when authenticated", async () => {
		renderLayout(fakeLocalApi({ status: "authenticated", user: { username: "ada" } }));

		// Give the async auth delegate a tick to resolve to authenticated.
		await expect.element(page.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: "Log in" })).not.toBeInTheDocument();
	});

	it("calls auth.login on click", async () => {
		const login = vi.fn(async (): Promise<AuthSession> => ({ status: "anonymous" }));
		renderLayout(fakeLocalApi({ status: "anonymous" }, { login }));

		await page.getByRole("button", { name: "Log in" }).click();

		expect(login).toHaveBeenCalledTimes(1);
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
		await page.getByRole("menuitem", { name: "Log out" }).click();

		expect(logout).toHaveBeenCalledTimes(1);
	});
});
