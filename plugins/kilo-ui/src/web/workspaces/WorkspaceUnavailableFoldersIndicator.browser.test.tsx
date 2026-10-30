import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { Workspace } from "../../contracts/workspaces/schemas.js";

import { WorkspacesContext, type WorkspacesContextValue } from "./WorkspacesFeatureContext.js";
import { WorkspaceUnavailableFoldersIndicator } from "./WorkspaceUnavailableFoldersIndicator.js";

const activeWorkspace: Workspace = {
	id: "workspace-active",
	name: "Active workspace",
	folders: [{ id: "folder-active", path: "/projects/active", isPrimary: true, position: 0 }],
	createdAt: 1,
	updatedAt: 1,
};

const threadWorkspace: Workspace = {
	...activeWorkspace,
	id: "workspace-thread",
	name: "Thread workspace",
};

afterEach(cleanup);

function renderIndicator({
	workspaceId,
	unavailableWorkspaceId,
}: {
	workspaceId?: string;
	unavailableWorkspaceId: string | undefined;
}) {
	const openEdit = vi.fn();
	const value: WorkspacesContextValue = {
		workspaces: [activeWorkspace, threadWorkspace],
		activeWorkspaceId: activeWorkspace.id,
		setActiveWorkspaceId: () => undefined,
		isLoading: false,
		isUnavailable: false,
		hasUnavailableFolders: (candidateId) => candidateId === unavailableWorkspaceId,
		openCreate: () => undefined,
		openEdit,
		openDelete: () => undefined,
	};
	render(
		<WorkspacesContext.Provider value={value}>
			<WorkspaceUnavailableFoldersIndicator
				{...(workspaceId === undefined ? {} : { workspaceId })}
			/>
		</WorkspacesContext.Provider>,
	);
	return { openEdit };
}

describe("WorkspaceUnavailableFoldersIndicator", () => {
	it("opens active workspace settings when draft chat folders are unavailable", async () => {
		const { openEdit } = renderIndicator({ unavailableWorkspaceId: activeWorkspace.id });

		await page.getByTestId("kilo-composer-unavailable-folders").click();

		expect(openEdit).toHaveBeenCalledWith(activeWorkspace);
	});

	it("uses the thread workspace instead of the active workspace", async () => {
		const { openEdit } = renderIndicator({
			workspaceId: threadWorkspace.id,
			unavailableWorkspaceId: threadWorkspace.id,
		});

		await page.getByTestId("kilo-composer-unavailable-folders").click();

		expect(openEdit).toHaveBeenCalledWith(threadWorkspace);
	});

	it("does not fall back to the active workspace for an unresolved thread workspace", async () => {
		renderIndicator({
			workspaceId: "workspace-deleted",
			unavailableWorkspaceId: activeWorkspace.id,
		});

		await expect
			.element(page.getByTestId("kilo-composer-unavailable-folders"))
			.not.toBeInTheDocument();
	});

	it("does not render for available folders", async () => {
		renderIndicator({ unavailableWorkspaceId: undefined });

		await expect
			.element(page.getByTestId("kilo-composer-unavailable-folders"))
			.not.toBeInTheDocument();
	});
});
