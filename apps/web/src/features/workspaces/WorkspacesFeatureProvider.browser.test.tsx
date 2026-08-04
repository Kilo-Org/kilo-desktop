import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import {
	workspacesContract,
	type Workspace,
	type WorkspacesService,
} from "@anaconda-agentic-desktop/contracts";
import { SdkProvider } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import { useWorkspacesFeature, WorkspacesFeatureProvider } from "./WorkspacesFeatureProvider";

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
		featureId: "workspaces",
		channels: workspacesContract,
		handlers,
	});
	const system = createFakeFeatureSystem({ sdks: { workspaces: sdk } });
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
