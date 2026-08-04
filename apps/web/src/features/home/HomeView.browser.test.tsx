import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { workspacesContract } from "@anaconda-agentic-desktop/contracts";
import { createFakeSdk, createFakeFeatureSystem } from "@anaconda-agentic-desktop/testing";
import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";

import { WorkspacesFeatureProvider } from "@/features/workspaces/WorkspacesFeatureProvider";
import { HomeView } from "./HomeView";

afterEach(() => {
	cleanup();
	localStorage.clear();
});

/** HomeView renders the "dashboard" zone, which needs a feature system. */
function renderHome() {
	const workspaces = createFakeSdk({
		featureId: "workspaces",
		channels: workspacesContract,
		handlers: { list: async () => [] },
	});
	const system = createFakeFeatureSystem({ sdks: { workspaces } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<div className="h-[600px]">
						<HomeView />
					</div>
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
}

describe("HomeView", () => {
	it("shows the centered welcome title and prompt input", async () => {
		const { baseElement } = renderHome();
		const screen = page.elementLocator(baseElement);

		await expect.element(screen.getByText("What would you like to build?")).toBeVisible();
		await expect.element(screen.getByRole("textbox", { name: "Message input" })).toBeVisible();
	});

	it("runs the stub chat model when a message is sent", async () => {
		const { baseElement } = renderHome();
		const screen = page.elementLocator(baseElement);
		const input = screen.getByRole("textbox", { name: "Message input" });
		await input.fill("hello");
		await screen.getByRole("button", { name: "Send message" }).click();
		await expect.element(input).toHaveValue("");
	});
});
