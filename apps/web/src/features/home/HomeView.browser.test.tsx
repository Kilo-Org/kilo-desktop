import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import {
	workspacesContract,
	type Workspace,
	type WorkspaceCapabilities,
} from "@anaconda-agentic-desktop/contracts";
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
	const workspace: Workspace = {
		id: "workspace-1",
		name: "Workspace 1",
		folders: [
			{
				id: "folder-1",
				path: "/projects/workspace-1",
				isPrimary: true,
				position: 0,
			},
		],
		createdAt: 1,
		updatedAt: 1,
	};
	const get = vi.fn(async ({ id }: { id: string }) => ({ ...workspace, id }));
	const remove = vi.fn(async () => ({ deleted: true }));
	const workspaces = createFakeSdk({
		featureId: "workspaces",
		channels: workspacesContract,
		handlers: { list: async () => [], get, remove },
	});
	const system = createFakeFeatureSystem({ sdks: { workspaces } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const result = render(
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
	return { ...result, workspaces, workspace, get, remove };
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

	it("exposes id-based workspace capabilities through the renderer SDK", async () => {
		const { workspaces, workspace, get, remove } = renderHome();
		const capability =
			workspaces.plugins.get<WorkspaceCapabilities>("workspaces")?.workspaceService;

		expect(capability).toBeDefined();
		await expect(capability!.get(workspace.id)).resolves.toEqual(workspace);
		await expect(capability!.remove(workspace.id)).resolves.toEqual({ deleted: true });
		expect(get).toHaveBeenCalledWith({ id: workspace.id });
		expect(remove).toHaveBeenCalledWith({ id: workspace.id });
	});
});
