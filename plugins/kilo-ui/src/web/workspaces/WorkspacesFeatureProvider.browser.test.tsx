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
import {
	workspaceStatusContract,
	type WorkspaceStatusService,
} from "../../contracts/workspaces/status.js";
import {
	readSessionListView,
	SESSION_LIST_VIEW_STORAGE_KEY,
	UNSCOPED_WORKSPACE_FOCUS,
	writeSessionListView,
} from "../session/list/session-list-view.js";
import { SdkProvider } from "@kilo-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeMainSdk, createFakeSdk } from "@kilo-desktop/testing";

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
	const { activeWorkspaceId, hasUnavailableFolders, openDelete, workspaces } =
		useWorkspacesFeature();
	const selected = workspaces[0];
	return (
		<>
			<output aria-label="Active workspace">{activeWorkspaceId ?? "none"}</output>
			<output aria-label="Workspace folder status">
				{selected && hasUnavailableFolders?.(selected.id) ? "unavailable" : "available"}
			</output>
			<button type="button" disabled={!selected} onClick={() => selected && openDelete(selected)}>
				Open delete
			</button>
		</>
	);
}

function renderProvider(
	handlers: Partial<WorkspacesService>,
	statusHandlers: Partial<WorkspaceStatusService> = {},
) {
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: workspacesContract,
		handlers,
	});
	const statusMainSdk = createFakeMainSdk({ featureId: "kilo-ui", services: sdk.services });
	statusMainSdk.channels(workspaceStatusContract).handleAll({
		"workspaceStatus.list": async () => [],
		...statusHandlers,
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

	it("keeps active workspace null when workspaces exist (unscoped)", async () => {
		renderProvider({ list: async () => [workspace] });

		await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("none");
	});

	it("provides unavailable folder status for matching workspaces", async () => {
		renderProvider(
			{ list: async () => [workspace] },
			{
				"workspaceStatus.list": async () => [
					{ workspaceId: workspace.id, unavailableFolders: [workspace.folders[0]!.path] },
				],
			},
		);

		await expect
			.element(page.getByLabelText("Workspace folder status"))
			.toHaveTextContent("unavailable");
	});

	it("clears an invalid stored workspace id to null", async () => {
		localStorage.setItem("kilo-ui.active-workspace", "missing-workspace");
		renderProvider({ list: async () => [workspace] });

		await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("none");
	});

	it("reconciles stored active and focused workspace ids missing from the list", async () => {
		localStorage.setItem("kilo-ui.active-workspace", "missing-workspace");
		writeSessionListView({
			grouping: "lifecycle",
			ordering: "recency",
			show: ["pr"],
			status: "all",
			pullRequest: "all",
			focus: "missing-workspace",
		});
		renderProvider({ list: async () => [workspace] });

		await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("none");
		expect(localStorage.getItem("kilo-ui.active-workspace")).toBeNull();
		expect(readSessionListView().focus).toBeNull();
	});

	it("preserves a stored focus for a workspace in the list", async () => {
		writeSessionListView({
			grouping: "lifecycle",
			ordering: "recency",
			show: ["pr"],
			status: "all",
			pullRequest: "all",
			focus: workspace.id,
		});
		const setItem = vi.spyOn(Storage.prototype, "setItem");
		renderProvider({ list: async () => [workspace] });

		await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("none");
		expect(readSessionListView().focus).toBe(workspace.id);
		expect(setItem).not.toHaveBeenCalledWith(SESSION_LIST_VIEW_STORAGE_KEY, expect.any(String));
	});

	it("preserves the unscoped focus sentinel when workspaces exist", async () => {
		writeSessionListView({
			grouping: "lifecycle",
			ordering: "recency",
			show: ["pr"],
			status: "all",
			pullRequest: "all",
			focus: UNSCOPED_WORKSPACE_FOCUS,
		});
		renderProvider({ list: async () => [workspace] });

		await expect.element(page.getByLabelText("Active workspace")).toHaveTextContent("none");
		expect(readSessionListView().focus).toBe(UNSCOPED_WORKSPACE_FOCUS);
	});

	it("does not reactivate a deleted workspace while its list refetch is pending", async () => {
		localStorage.setItem("kilo-ui.active-workspace", workspace.id);
		writeSessionListView({
			grouping: "lifecycle",
			ordering: "recency",
			show: ["pr"],
			status: "all",
			pullRequest: "all",
			focus: workspace.id,
		});
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
		expect(localStorage.getItem("kilo-ui.active-workspace")).toBeNull();
		expect(readSessionListView().focus).toBeNull();
	});

	it("shows the failure when deleting a workspace rejects", async () => {
		localStorage.setItem("kilo-ui.active-workspace", workspace.id);
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
