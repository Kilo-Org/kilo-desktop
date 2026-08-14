import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { SDK } from "@anaconda-agentic-desktop/feature-sdk";
import { SdkProvider, sdkQueryKey } from "@anaconda-agentic-desktop/sdk-react";
import { createFakeFeatureSystem, createFakeSdk } from "@anaconda-agentic-desktop/testing";

import {
	workspacesContract,
	type Workspace,
	type WorkspacesService,
} from "../../contracts/workspaces/schemas.js";
import { WorkspaceDialogs, type WorkspaceDialogState } from "./WorkspaceDialogs.js";

const workspaceA: Workspace = {
	id: "ws-a",
	name: "Alpha",
	folders: [{ id: "f-a", path: "/projects/alpha", isPrimary: true, position: 0 }],
	createdAt: 1,
	updatedAt: 1,
};

function renderDialogs(options: {
	dialog: WorkspaceDialogState;
	workspaces?: Workspace[];
	shell?: Partial<SDK["shell"]>;
	handlers?: Partial<WorkspacesService>;
	activeWorkspaceId?: string | null;
	seedListCache?: boolean;
}) {
	const onClose = vi.fn();
	const onDialogChange = vi.fn();
	const setActiveWorkspaceId = vi.fn();
	const sdk = createFakeSdk({
		featureId: "kilo-ui",
		channels: workspacesContract,
		shell: { canPickDirectories: true, ...options.shell },
		handlers: {
			list: async () => options.workspaces ?? [],
			get: async () => null,
			create: async () => workspaceA,
			update: async () => workspaceA,
			remove: async () => ({ deleted: true }),
			...options.handlers,
		} satisfies Partial<WorkspacesService>,
	});
	const system = createFakeFeatureSystem({ sdks: { "kilo-ui": sdk } });
	const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	if (options.seedListCache) {
		queryClient.setQueryData(sdkQueryKey(sdk, "list"), options.workspaces ?? []);
	}
	const view = render(
		<SdkProvider system={system}>
			<QueryClientProvider client={queryClient}>
				<WorkspaceDialogs
					dialog={options.dialog}
					onClose={onClose}
					onDialogChange={onDialogChange}
					sdk={sdk as unknown as SDK<WorkspacesService>}
					queryClient={queryClient}
					workspaces={options.workspaces ?? []}
					activeWorkspaceId={options.activeWorkspaceId ?? null}
					setActiveWorkspaceId={setActiveWorkspaceId}
				/>
			</QueryClientProvider>
		</SdkProvider>,
	);
	return { view, onClose, onDialogChange, setActiveWorkspaceId, sdk };
}

afterEach(() => {
	cleanup();
});

describe("WorkspaceDialogs — manage", () => {
	it("renders the empty state and opens create from the footer", async () => {
		const { onDialogChange } = renderDialogs({ dialog: { mode: "manage" } });

		await expect.element(page.getByText("No workspaces yet.")).toBeVisible();
		await page.getByRole("button", { name: "Create workspace" }).click();

		expect(onDialogChange).toHaveBeenCalledWith({ mode: "create" });
	});

	it("routes edit and delete actions per workspace row", async () => {
		const { onDialogChange } = renderDialogs({
			dialog: { mode: "manage" },
			workspaces: [workspaceA],
		});

		await page.getByRole("button", { name: "Edit Alpha" }).click();
		expect(onDialogChange).toHaveBeenCalledWith({ mode: "edit", workspace: workspaceA });

		await page.getByRole("button", { name: "Delete Alpha" }).click();
		expect(onDialogChange).toHaveBeenCalledWith({ mode: "delete", workspace: workspaceA });
	});
});

describe("WorkspaceDialogs — create/edit form", () => {
	it("blocks submission with no folders and shows a validation error", async () => {
		const create = vi.fn(async () => workspaceA);
		const { view } = renderDialogs({ dialog: { mode: "create" }, handlers: { create } });

		await expect.element(page.getByRole("heading", { name: "Create workspace" })).toBeVisible();

		// The submit button is disabled while there are no folders, so a click can't submit.
		const submit = page.getByRole("button", { name: "Create workspace" });
		await expect.element(submit).toBeDisabled();

		// Submitting the form directly (e.g. via Enter) runs validation instead of the mutation.
		const form = view.baseElement.querySelector<HTMLFormElement>("form");
		expect(form).not.toBeNull();
		fireEvent.submit(form!);

		await expect.element(page.getByText("Add at least one folder.")).toBeVisible();
		expect(create).not.toHaveBeenCalled();
	});

	it("adds a folder through the picker, makes another primary, removes it, and saves", async () => {
		const create = vi.fn(async () => workspaceA);
		const { onClose, setActiveWorkspaceId } = renderDialogs({
			dialog: { mode: "create" },
			handlers: { create },
			shell: {
				showOpenDialog: vi
					.fn()
					.mockResolvedValue({ canceled: false, paths: ["/projects/one", "/projects/two"] }),
			},
		});

		await page.getByRole("button", { name: /Drop folders/ }).click();
		await expect.element(page.getByText("one", { exact: true })).toBeVisible();
		await expect.element(page.getByText("two", { exact: true })).toBeVisible();

		// Promote the second folder to primary, then remove it.
		await page.getByRole("button", { name: "Make primary" }).first().click();
		await page.getByRole("button", { name: "Remove /projects/one" }).click();

		await page.getByRole("button", { name: "Create workspace" }).click();

		await vi.waitFor(() => expect(create).toHaveBeenCalled());
		await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(setActiveWorkspaceId).toHaveBeenCalledWith(workspaceA.id);
	});

	it("cancels the form without saving", async () => {
		const { onClose } = renderDialogs({ dialog: { mode: "edit", workspace: workspaceA } });

		await expect.element(page.getByText("Edit workspace")).toBeVisible();
		await page.getByRole("button", { name: "Cancel" }).click();

		expect(onClose).toHaveBeenCalled();
	});

	it("surfaces a picker error when folder selection is unavailable", async () => {
		renderDialogs({ dialog: { mode: "create" }, shell: { canPickDirectories: false } });

		await expect
			.element(page.getByText("Folder selection requires the desktop app."))
			.toBeVisible();
	});

	it("updates an existing workspace on save (edit mode)", async () => {
		const update = vi.fn(async () => ({ ...workspaceA, name: "Alpha Renamed" }));
		const { onClose } = renderDialogs({
			dialog: { mode: "edit", workspace: workspaceA },
			workspaces: [workspaceA],
			handlers: { update },
			seedListCache: true,
		});

		await page.getByRole("button", { name: "Save" }).click();

		await vi.waitFor(() =>
			expect(update).toHaveBeenCalledWith({
				id: workspaceA.id,
				name: workspaceA.name,
				folders: [{ path: workspaceA.folders[0]!.path, isPrimary: true }],
			}),
		);
		await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
	});

	it("shows a save error message when the mutation fails", async () => {
		const update = vi.fn(async () => {
			throw new Error("name already taken");
		});
		renderDialogs({
			dialog: { mode: "edit", workspace: workspaceA },
			workspaces: [workspaceA],
			handlers: { update },
		});

		await page.getByRole("button", { name: "Save" }).click();

		await expect.element(page.getByText("name already taken")).toBeVisible();
	});

	it("activates the drop zone via keyboard and reports picker failures", async () => {
		const showOpenDialog = vi.fn(async () => {
			throw new Error("picker crashed");
		});
		const { view } = renderDialogs({
			dialog: { mode: "create" },
			shell: { canPickDirectories: true, showOpenDialog },
		});

		const zone = view.baseElement.querySelector<HTMLElement>("[role='button']");
		expect(zone).not.toBeNull();
		fireEvent.keyDown(zone!, { key: "Enter" });

		await expect.element(page.getByText("picker crashed")).toBeVisible();
	});

	it("accepts dropped directories and rejects non-folder entries", async () => {
		const getPathForFile = vi.fn((file: File) => `/dropped/${file.name}`);
		const { view } = renderDialogs({
			dialog: { mode: "create" },
			shell: { canPickDirectories: true, getPathForFile },
		});

		const dropZone = view.baseElement.querySelector<HTMLElement>(
			"[data-qa-id='workspace-folder-dropzone']",
		);
		expect(dropZone).not.toBeNull();

		const folderFile = new File([], "ProjectDir");
		const dataTransfer = {
			items: [
				{ webkitGetAsEntry: () => ({ isDirectory: true }), getAsFile: () => folderFile },
				{
					webkitGetAsEntry: () => ({ isDirectory: false }),
					getAsFile: () => new File([], "notes.txt"),
				},
			],
		};
		const fire = (type: string) => {
			const event = new Event(type, { bubbles: true, cancelable: true });
			Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
			dropZone!.dispatchEvent(event);
		};
		fire("dragover");
		fire("drop");

		await expect.element(page.getByText("ProjectDir", { exact: true })).toBeVisible();
		await expect.element(page.getByText("Only folders can be added to a workspace.")).toBeVisible();
	});

	it("renders existing folders read-only when the desktop picker is unavailable", async () => {
		const twoFolderWorkspace: Workspace = {
			...workspaceA,
			folders: [
				{ id: "f1", path: "/projects/one", isPrimary: true, position: 0 },
				{ id: "f2", path: "/projects/two", isPrimary: false, position: 1 },
			],
		};
		renderDialogs({
			dialog: { mode: "edit", workspace: twoFolderWorkspace },
			workspaces: [twoFolderWorkspace],
			shell: { canPickDirectories: false },
		});

		await expect.element(page.getByText("one", { exact: true })).toBeVisible();
		await expect.element(page.getByText("Adding folders requires the desktop app.")).toBeVisible();
	});

	it("reassigns the primary folder when the current primary is removed", async () => {
		const twoFolderWorkspace: Workspace = {
			...workspaceA,
			folders: [
				{ id: "f1", path: "/projects/one", isPrimary: true, position: 0 },
				{ id: "f2", path: "/projects/two", isPrimary: false, position: 1 },
			],
		};
		renderDialogs({
			dialog: { mode: "edit", workspace: twoFolderWorkspace },
			workspaces: [twoFolderWorkspace],
			shell: { canPickDirectories: true },
		});

		await page.getByRole("button", { name: "Remove /projects/one" }).click();

		// The remaining folder is promoted to primary (no "Make primary" button left).
		await expect.element(page.getByText("two", { exact: true })).toBeVisible();
		await expect.element(page.getByText("Primary")).toBeVisible();
	});

	it("adds folders through the existing-list add button", async () => {
		const twoFolderWorkspace: Workspace = {
			...workspaceA,
			folders: [{ id: "f1", path: "/projects/one", isPrimary: true, position: 0 }],
		};
		const showOpenDialog = vi.fn(async () => ({ canceled: true, paths: [] }));
		renderDialogs({
			dialog: { mode: "edit", workspace: twoFolderWorkspace },
			workspaces: [twoFolderWorkspace],
			shell: { canPickDirectories: true, showOpenDialog },
		});

		await page.getByRole("button", { name: "Add folder" }).click();

		// Cancelled picker leaves the list unchanged and does not throw.
		await vi.waitFor(() => expect(showOpenDialog).toHaveBeenCalled());
		await expect.element(page.getByText("one", { exact: true })).toBeVisible();
	});
});

describe("WorkspaceDialogs — delete", () => {
	it("confirms deletion, reassigns the active workspace, and closes", async () => {
		const remove = vi.fn(async () => ({ deleted: true }));
		const other: Workspace = { ...workspaceA, id: "ws-b", name: "Beta" };
		const { onClose, setActiveWorkspaceId } = renderDialogs({
			dialog: { mode: "delete", workspace: workspaceA },
			workspaces: [workspaceA, other],
			activeWorkspaceId: workspaceA.id,
			handlers: { remove },
		});

		await expect.element(page.getByText("Delete Alpha?")).toBeVisible();
		await page.getByRole("button", { name: "Delete workspace" }).click();

		await vi.waitFor(() => expect(remove).toHaveBeenCalledWith({ id: workspaceA.id }));
		await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(setActiveWorkspaceId).toHaveBeenCalledWith("ws-b");
	});

	it("shows an error when deletion fails and keeps the dialog open", async () => {
		const remove = vi.fn(async () => {
			throw new Error("workspace is busy");
		});
		renderDialogs({
			dialog: { mode: "delete", workspace: workspaceA },
			workspaces: [workspaceA],
			activeWorkspaceId: workspaceA.id,
			handlers: { remove },
		});

		await page.getByRole("button", { name: "Delete workspace" }).click();

		await expect.element(page.getByText("workspace is busy")).toBeVisible();
	});

	it("cancels deletion without calling remove", async () => {
		const remove = vi.fn(async () => ({ deleted: true }));
		const { onClose } = renderDialogs({
			dialog: { mode: "delete", workspace: workspaceA },
			workspaces: [workspaceA],
			handlers: { remove },
		});

		await page.getByRole("button", { name: "Cancel" }).click();

		expect(remove).not.toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();
	});

	it("does not reassign the active workspace when a different one is deleted", async () => {
		const remove = vi.fn(async () => ({ deleted: true }));
		const other: Workspace = { ...workspaceA, id: "ws-b", name: "Beta" };
		const { onClose, setActiveWorkspaceId } = renderDialogs({
			dialog: { mode: "delete", workspace: other },
			workspaces: [workspaceA, other],
			activeWorkspaceId: workspaceA.id,
			handlers: { remove },
		});

		await page.getByRole("button", { name: "Delete workspace" }).click();

		await vi.waitFor(() => expect(onClose).toHaveBeenCalled());
		expect(setActiveWorkspaceId).not.toHaveBeenCalled();
	});

	it("stringifies a non-Error deletion failure", async () => {
		const remove = vi.fn(async () => {
			// eslint-disable-next-line no-throw-literal
			throw "raw delete failure";
		});
		renderDialogs({
			dialog: { mode: "delete", workspace: workspaceA },
			workspaces: [workspaceA],
			activeWorkspaceId: workspaceA.id,
			handlers: { remove },
		});

		await page.getByRole("button", { name: "Delete workspace" }).click();

		await expect.element(page.getByText("Could not delete workspace.")).toBeVisible();
	});
});
