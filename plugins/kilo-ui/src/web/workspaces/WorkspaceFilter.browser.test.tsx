import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { Workspace } from "../../contracts/workspaces/schemas.js";

import { WorkspacesContext, type WorkspacesContextValue } from "./WorkspacesFeatureContext.js";
import { WorkspaceFilter } from "./WorkspaceFilter.js";

const workspace: Workspace = {
	id: "workspace-1",
	name: "Workspace",
	folders: [{ id: "folder-1", path: "/projects/workspace", isPrimary: true, position: 0 }],
	createdAt: 1,
	updatedAt: 1,
};

afterEach(cleanup);

function renderFilter(hasUnavailableFolders: boolean) {
	const openEdit = vi.fn();
	const onValueChange = vi.fn();
	const value: WorkspacesContextValue = {
		workspaces: [workspace],
		activeWorkspaceId: workspace.id,
		setActiveWorkspaceId: () => undefined,
		isLoading: false,
		isUnavailable: false,
		hasUnavailableFolders: () => hasUnavailableFolders,
		openCreate: () => undefined,
		openEdit,
		openDelete: () => undefined,
	};
	render(
		<WorkspacesContext.Provider value={value}>
			<WorkspaceFilter
				value={workspace.id}
				unscopedValue="unscoped"
				onValueChange={onValueChange}
			/>
		</WorkspacesContext.Provider>,
	);
	return { onValueChange, openEdit };
}

describe("WorkspaceFilter", () => {
	it("opens the selected workspace settings from its unavailable-folder indicator", async () => {
		const { onValueChange, openEdit } = renderFilter(true);

		await page.getByTestId("workspace-filter-unavailable-folders-indicator").click();

		expect(openEdit).toHaveBeenCalledWith(workspace);
		expect(onValueChange).not.toHaveBeenCalled();
	});

	it("does not render an indicator when selected workspace folders are available", async () => {
		renderFilter(false);

		await expect
			.element(page.getByTestId("workspace-filter-unavailable-folders-indicator"))
			.not.toBeInTheDocument();
	});
});
