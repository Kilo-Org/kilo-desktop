import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import {
	useWorkspacePicker,
	WorkspacePickerRoot,
	WorkspacePickerSourceProvider,
	WorkspacePickerTrigger,
	type WorkspacePickerSource,
} from "./workspace-picker";

const WORKSPACES = [
	{ id: "w-a", name: "Alpha", color: "#5ea0f7" },
	{ id: "w-b", name: "Beta", color: "#34D399" },
];

function Trigger() {
	const { triggerLabel } = useWorkspacePicker();
	return (
		<WorkspacePickerTrigger aria-label="Select workspace" render={<button type="button" />}>
			{triggerLabel}
		</WorkspacePickerTrigger>
	);
}

function renderPicker(
	overrides: Partial<WorkspacePickerSource> = {},
	root: { value?: string | null; onValueChange?: (id: string | null) => void } = {},
) {
	const source: WorkspacePickerSource = {
		workspaces: WORKSPACES,
		activeWorkspaceId: null,
		setActiveWorkspaceId: vi.fn(),
		isLoading: false,
		isUnavailable: false,
		hasUnavailableFolders: () => false,
		openCreate: vi.fn(),
		openEdit: vi.fn(),
		openDelete: vi.fn(),
		...overrides,
	};
	render(
		<WorkspacePickerSourceProvider value={source}>
			<WorkspacePickerRoot {...root}>
				<Trigger />
			</WorkspacePickerRoot>
		</WorkspacePickerSourceProvider>,
	);
	return source;
}

const open = () => page.getByRole("combobox", { name: "Select workspace" }).click();

afterEach(cleanup);

describe("workspace picker", () => {
	it("lists No workspace first, then each workspace tinted with its colour", async () => {
		renderPicker();
		await open();

		const options = page
			.getByRole("option")
			.elements()
			.map((option) => option.textContent);
		expect(options[0]).toContain("No workspace");
		const alpha = page.getByRole("option", { name: /Alpha/ }).element().querySelector("svg");
		expect(alpha?.getAttribute("stroke")).toBe("#5EA0F7");
	});

	it("sets the active workspace when nothing else handles the choice", async () => {
		const source = renderPicker();
		await open();

		await page.getByRole("option", { name: /Beta/ }).click();

		expect(source.setActiveWorkspaceId).toHaveBeenCalledWith("w-b");
	});

	it("reports No workspace as the host's unscoped value", async () => {
		const onValueChange = vi.fn();
		renderPicker({}, { value: null, onValueChange });
		await open();

		await page.getByRole("option", { name: /No workspace/ }).click();

		expect(onValueChange).toHaveBeenCalledWith(null);
	});

	it("filters workspaces by name", async () => {
		renderPicker();
		await open();

		await userEvent.keyboard("bet");

		await expect.element(page.getByRole("option", { name: /Beta/ })).toBeVisible();
		await expect.element(page.getByRole("option", { name: /Alpha/ })).not.toBeInTheDocument();
	});

	it("marks a workspace with unavailable folders and opens edit from the mark", async () => {
		const source = renderPicker({ hasUnavailableFolders: (id) => id === "w-a" });
		await open();

		expect(page.getByTestId("workspace-unavailable-folders-indicator").elements()).toHaveLength(1);
		await page.getByTestId("workspace-unavailable-folders-indicator").click();

		expect(source.openEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "w-a" }));
		expect(source.setActiveWorkspaceId).not.toHaveBeenCalled();
	});

	it("offers to create a workspace", async () => {
		const source = renderPicker({ workspaces: [] });
		await open();

		await page.getByRole("option", { name: /New workspace/ }).click();

		expect(source.openCreate).toHaveBeenCalled();
	});
});
