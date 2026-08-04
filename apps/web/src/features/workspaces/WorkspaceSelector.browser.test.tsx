import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { AppProviders } from "@/app/AppProviders";
import { WEB_FEATURES } from "@/features/features";
import { createBrowserLocalApi } from "@/platform/browserLocalApi";
import { createAppFeatureSystem } from "@/platform/featureSystem";
import { WorkspaceSelector } from "./WorkspaceSelector";

afterEach(() => {
	cleanup();
	localStorage.clear();
});

describe("WorkspaceSelector", () => {
	it("creates an unnamed workspace through the native folder delegate", async () => {
		const api = createBrowserLocalApi();
		api.shell = {
			...api.shell,
			canPickDirectories: true,
			showOpenDialog: vi
				.fn()
				.mockResolvedValueOnce({ canceled: false, paths: ["/tmp/Project"] })
				.mockResolvedValueOnce({ canceled: false, paths: ["/tmp/Second"] }),
		};
		const system = createAppFeatureSystem(api, WEB_FEATURES);
		render(
			<AppProviders localApi={api} system={system}>
				<WorkspaceSelector />
			</AppProviders>,
		);

		await page.getByRole("combobox", { name: "Select workspace" }).click();
		expect(
			document.querySelector('[data-slot="popover-content"]')?.parentElement?.dataset.side,
		).toBe("bottom");
		await expect.element(page.getByText("No workspaces yet.")).toBeVisible();
		await page.getByText("Create workspace", { exact: true }).click();
		await page.getByRole("button", { name: /Drop folders/ }).click();
		const projectFolder = page.getByText("Project", { exact: true });
		await expect.element(projectFolder).toBeVisible();
		await projectFolder.hover();
		await expect.element(page.getByText("/tmp/Project", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Create workspace" }).click();
		await expect
			.element(page.getByRole("combobox", { name: "Select workspace" }))
			.toHaveTextContent("Project");

		await page.getByRole("combobox", { name: "Select workspace" }).click();
		const workspaceOption = document.querySelector<HTMLElement>(
			'[data-slot="command-item"]:not([data-value="create-workspace"])',
		);
		expect(workspaceOption).not.toBeNull();
		expect(workspaceOption).toHaveAttribute("aria-selected", "false");
		fireEvent.pointerMove(workspaceOption!);
		await waitFor(() => expect(workspaceOption).toHaveAttribute("aria-selected", "true"));
		await page.getByRole("button", { name: "Workspace actions for Project" }).click();
		await page.getByText("Edit", { exact: true }).click();
		await page.getByRole("button", { name: "Add folder" }).click();
		const secondFolder = page.getByText("Second", { exact: true });
		await expect.element(secondFolder).toBeVisible();
		await secondFolder.hover();
		await expect.element(page.getByText("/tmp/Second", { exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Make primary" }).click();
		await page.getByRole("textbox", { name: /Workspace name/ }).fill("");
		await page.getByRole("button", { name: "Save" }).click();
		await expect
			.element(page.getByRole("combobox", { name: "Select workspace" }))
			.toHaveTextContent("Second");

		system.getSdk("workspaces").events.emit("open-manager");
		await expect.element(page.getByText("Manage workspaces", { exact: true })).toBeVisible();
		await expect.element(page.getByRole("button", { name: "Edit Second" })).toBeVisible();
		await expect.element(page.getByRole("button", { name: "Delete Second" })).toBeVisible();
		await page.getByRole("button", { name: "Close" }).click();

		await page.getByRole("combobox", { name: "Select workspace" }).click();
		await page.getByRole("button", { name: "Workspace actions for Second" }).click();
		await page.getByText("Delete", { exact: true }).click();
		await page.getByRole("button", { name: "Delete workspace" }).click();
		await userEvent.keyboard("{ArrowDown}");
		await expect.element(page.getByText("No workspaces yet.")).toBeVisible();
		await userEvent.keyboard("{Escape}");
	});

	it("filters workspaces by name when searching", async () => {
		const api = createBrowserLocalApi();
		api.shell = {
			...api.shell,
			canPickDirectories: true,
			showOpenDialog: vi
				.fn()
				.mockResolvedValueOnce({ canceled: false, paths: ["/tmp/AlphaProject"] })
				.mockResolvedValueOnce({ canceled: false, paths: ["/tmp/BetaProject"] }),
		};
		const system = createAppFeatureSystem(api, WEB_FEATURES);
		render(
			<AppProviders localApi={api} system={system}>
				<WorkspaceSelector />
			</AppProviders>,
		);

		for (const name of ["AlphaProject", "BetaProject"]) {
			await page.getByRole("combobox", { name: "Select workspace" }).click();
			await page.getByText("Create workspace", { exact: true }).click();
			await page.getByRole("button", { name: /Drop folders/ }).click();
			await page.getByRole("button", { name: "Create workspace" }).click();
			await expect
				.element(page.getByRole("combobox", { name: "Select workspace" }))
				.toHaveTextContent(name);
		}

		await page.getByRole("combobox", { name: "Select workspace" }).click();
		const alphaOption = page.getByRole("option", { name: /AlphaProject/ }).element();
		fireEvent.pointerMove(alphaOption);
		await waitFor(() => expect(alphaOption).toHaveAttribute("aria-selected", "true"));
		await page.getByRole("button", { name: "Workspace actions for AlphaProject" }).click();
		await page.getByText("Edit", { exact: true }).click();
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect
			.element(page.getByRole("combobox", { name: "Select workspace" }))
			.toHaveTextContent("BetaProject");

		await page.getByRole("combobox", { name: "Select workspace" }).click();
		const search = page.getByRole("combobox", { name: "Search workspaces" });
		await expect.element(search).toHaveFocus();

		await search.fill("alph");
		await expect.element(page.getByRole("option", { name: /AlphaProject/ })).toBeVisible();
		await expect.element(page.getByRole("option", { name: /BetaProject/ })).not.toBeInTheDocument();
		await expect
			.element(page.getByRole("option", { name: "Create workspace", exact: true }))
			.toBeVisible();

		await search.fill("zzzz");
		await expect.element(page.getByText("No workspaces found.")).toBeVisible();
		await expect.element(page.getByRole("option", { name: /Project/ })).not.toBeInTheDocument();
		await expect
			.element(page.getByRole("option", { name: "Create workspace", exact: true }))
			.toBeVisible();

		await search.fill("alph");
		await userEvent.keyboard("{Enter}");
		await expect
			.element(page.getByRole("combobox", { name: "Select workspace" }))
			.toHaveTextContent("AlphaProject");
	});

	it("shows a desktop-required state when directory picking is unavailable", async () => {
		const api = createBrowserLocalApi();
		const showOpenDialog = vi.spyOn(api.shell, "showOpenDialog");
		const system = createAppFeatureSystem(api, WEB_FEATURES);
		render(
			<AppProviders localApi={api} system={system}>
				<WorkspaceSelector />
			</AppProviders>,
		);

		await page.getByRole("combobox", { name: "Select workspace" }).click();
		await page.getByText("Create workspace", { exact: true }).click();
		await expect
			.element(page.getByText("Folder selection requires the desktop app.", { exact: true }))
			.toBeVisible();
		await expect
			.element(page.getByRole("button", { name: /Drop folders/ }))
			.not.toBeInTheDocument();
		await expect.element(page.getByRole("button", { name: "Create workspace" })).toBeDisabled();
		expect(showOpenDialog).not.toHaveBeenCalled();
	});

	it("keeps the specific validation message when a dropped item is not a folder", async () => {
		const api = createBrowserLocalApi();
		api.shell = {
			...api.shell,
			canPickDirectories: true,
		};
		const system = createAppFeatureSystem(api, WEB_FEATURES);
		render(
			<AppProviders localApi={api} system={system}>
				<WorkspaceSelector />
			</AppProviders>,
		);

		await page.getByRole("combobox", { name: "Select workspace" }).click();
		await page.getByText("Create workspace", { exact: true }).click();
		const drop = new DragEvent("drop", { bubbles: true, cancelable: true });
		Object.defineProperty(drop, "dataTransfer", {
			value: {
				items: [
					{
						webkitGetAsEntry: () => ({ isDirectory: false }),
						getAsFile: () => new File(["content"], "notes.txt"),
					},
				],
			},
		});
		fireEvent(page.getByRole("button", { name: /Drop folders/ }).element(), drop);

		await expect.element(page.getByText("Only folders can be added to a workspace.")).toBeVisible();
		await expect
			.element(page.getByText("Dropped folders could not be resolved."))
			.not.toBeInTheDocument();
	});

	it("prevents scrolling when Space opens the folder picker", async () => {
		const api = createBrowserLocalApi();
		const showOpenDialog = vi.fn().mockResolvedValue({ canceled: true, paths: [] });
		api.shell = {
			...api.shell,
			canPickDirectories: true,
			showOpenDialog,
		};
		const system = createAppFeatureSystem(api, WEB_FEATURES);
		render(
			<AppProviders localApi={api} system={system}>
				<WorkspaceSelector />
			</AppProviders>,
		);

		await page.getByRole("combobox", { name: "Select workspace" }).click();
		await page.getByText("Create workspace", { exact: true }).click();
		const dropZone = page.getByRole("button", { name: /Drop folders/ }).element();
		const space = new KeyboardEvent("keydown", {
			key: " ",
			bubbles: true,
			cancelable: true,
		});

		fireEvent(dropZone, space);

		expect(space.defaultPrevented).toBe(true);
		expect(showOpenDialog).toHaveBeenCalledOnce();
	});
});
