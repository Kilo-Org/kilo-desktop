import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	workspacesContract,
	type Workspace,
	type WorkspaceCapabilities,
	type WorkspacesService,
} from "../../contracts/workspaces/schemas.js";
import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { useWorkspacesFeature } from "./WorkspacesFeatureContext";
import { WorkspacesFeatureProvider } from "./WorkspacesFeatureProvider";

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

afterEach(() => {
	cleanup();
	localStorage.clear();
});

function Harness() {
	const { activeWorkspaceId, openDelete, workspaces } = useWorkspacesFeature();
	const selected = workspaces[0];
	return (
		<>
			<output aria-label="Active workspace">{activeWorkspaceId ?? "none"}</output>
			<button type="button" disabled={!selected} onClick={() => selected && openDelete(selected)}>
				Open delete
			</button>
		</>
	);
}

function renderProvider(handlers: Partial<WorkspacesService>) {
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: workspacesContract,
		handlers,
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const result = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspacesFeatureProvider>
					<Harness />
				</WorkspacesFeatureProvider>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { ...result, queryClient, sdk };
}

describe("WorkspacesFeatureProvider", () => {
	it("provides workspace state to its children", async () => {
		const { sdk } = renderProvider({ list: async () => [] });

		await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("none");
		sdk.events.emit("open-manager");
		await expect.element(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();
	});

	it("rejects consuming workspace state outside its provider", () => {
		expect(() => render(<Harness />)).toThrowError(
			"useWorkspacesFeature must be used within WorkspacesFeatureProvider.",
		);
	});

	it("exposes id-based workspace capabilities through the renderer SDK", async () => {
		const get = vi.fn(async ({ id }: { id: string }) => ({ ...workspace, id }));
		const remove = vi.fn(async () => ({ deleted: true }));
		const { sdk } = renderProvider({ list: async () => [], get, remove });
		const capability = sdk.plugins.get<WorkspaceCapabilities>("kilo-ui")?.workspaceService;

		expect(capability).toBeDefined();
		await expect(capability!.get(workspace.id)).resolves.toEqual(workspace);
		await expect(capability!.remove(workspace.id)).resolves.toEqual({ deleted: true });
		expect(get).toHaveBeenCalledWith({ id: workspace.id });
		expect(remove).toHaveBeenCalledWith({ id: workspace.id });
	});

	it("does not reactivate a deleted workspace while its list refetch is pending", async () => {
		let resolveRefetch!: (workspaces: Workspace[]) => void;
		const refetch = new Promise<Workspace[]>((resolve) => {
			resolveRefetch = resolve;
		});
		const list = vi.fn().mockResolvedValueOnce([workspace]).mockReturnValue(refetch);
		const remove = vi.fn().mockResolvedValue({ deleted: true });
		renderProvider({ list, remove });

		await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent(workspace.id);
		await page.getByRole("button", { name: "Open delete" }).click();
		await page.getByRole("button", { name: "Delete workspace" }).click();

		await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("none");
		expect(list).toHaveBeenCalledTimes(2);

		resolveRefetch([]);
		await expect
			.element(page.getByRole("heading", { name: `Delete ${workspace.name}?` }))
			.not.toBeInTheDocument();
		await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("none");
	});

	it("shows the failure when deleting a workspace rejects", async () => {
		const remove = vi.fn().mockRejectedValue(new Error("Workspace could not be deleted."));
		renderProvider({ list: async () => [workspace], remove });

		await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent(workspace.id);
		await page.getByRole("button", { name: "Open delete" }).click();
		await page.getByRole("button", { name: "Delete workspace" }).click();

		await expect
			.element(page.getByRole("alert"))
			.toHaveTextContent("Workspace could not be deleted.");
		await expect
			.element(page.getByRole("heading", { name: `Delete ${workspace.name}?` }))
			.toBeVisible();
	});
});
