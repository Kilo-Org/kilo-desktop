import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { page, userEvent } from "vitest/browser";

import { ChannelsDialog } from "./ChannelsDialog.js";

const CHANNELS = ["defaults", "conda-forge", "bioconda", "pytorch"];

function renderDialog(
	overrides: Partial<{
		open: boolean;
		availableChannels: string[];
		selectedChannels: string[];
		onCancel: () => void;
		onConfirm: (selected: string[]) => void;
	}> = {},
) {
	return render(
		<ChannelsDialog
			open={overrides.open ?? true}
			availableChannels={overrides.availableChannels ?? CHANNELS}
			selectedChannels={overrides.selectedChannels ?? CHANNELS}
			onCancel={overrides.onCancel ?? (() => {})}
			onConfirm={overrides.onConfirm ?? (() => {})}
		/>,
	);
}

/**
 * The Base-UI Checkbox renders `<span role="checkbox" aria-label="X">` inside
 * a `<label>` that also contains a visible `<span>X</span>`. Playwright's
 * accessible-name computation concatenates both, producing the doubled name
 * `"X X"`. Target the visible checkbox via this doubled name.
 */
function checkbox(label: string) {
	return page.getByRole("checkbox", { name: `${label} ${label}` });
}

afterEach(cleanup);

describe("ChannelsDialog", () => {
	it("renders the dialog with checkboxes for each channel", async () => {
		renderDialog();

		await expect.element(page.getByTestId("environments-channels-dialog")).toBeVisible();
		for (const channel of CHANNELS) {
			await expect.element(checkbox(channel)).toBeVisible();
		}
	});

	it("all channels are checked when selectedChannels matches availableChannels", async () => {
		renderDialog();

		for (const channel of CHANNELS) {
			await expect.element(checkbox(channel)).toBeChecked();
		}
		await expect.element(checkbox("All channels")).toBeChecked();
	});

	it("toggling a channel checkbox updates the working set", async () => {
		const onConfirm = vi.fn();
		renderDialog({ onConfirm });

		// Uncheck "bioconda"
		await userEvent.click(checkbox("bioconda"));
		await expect.element(checkbox("bioconda")).not.toBeChecked();

		// Confirm and verify the working set excludes "bioconda"
		await userEvent.click(page.getByTestId("environments-channels-confirm"));
		expect(onConfirm).toHaveBeenCalledWith(["defaults", "conda-forge", "pytorch"]);
	});

	it("the All channels toggle selects and deselects all channels", async () => {
		renderDialog();

		// Deselect all
		await userEvent.click(checkbox("All channels"));
		for (const channel of CHANNELS) {
			await expect.element(checkbox(channel)).not.toBeChecked();
		}

		// Select all
		await userEvent.click(checkbox("All channels"));
		for (const channel of CHANNELS) {
			await expect.element(checkbox(channel)).toBeChecked();
		}
	});

	it("filtering channels via search narrows the visible list", async () => {
		renderDialog();

		await userEvent.fill(page.getByTestId("environments-channels-search"), "forge");

		await expect.element(checkbox("conda-forge")).toBeVisible();
		await vi.waitFor(async () => {
			expect(await checkbox("defaults").all()).toHaveLength(0);
		});
		await vi.waitFor(async () => {
			expect(await checkbox("pytorch").all()).toHaveLength(0);
		});
	});

	it("clicking Done calls onConfirm with the working set", async () => {
		const onConfirm = vi.fn();
		renderDialog({ selectedChannels: ["defaults", "conda-forge"], onConfirm });

		await userEvent.click(page.getByTestId("environments-channels-confirm"));
		expect(onConfirm).toHaveBeenCalledWith(["defaults", "conda-forge"]);
	});

	it("clicking Cancel calls onCancel", async () => {
		const onCancel = vi.fn();
		renderDialog({ onCancel });

		await userEvent.click(page.getByText("Cancel"));
		expect(onCancel).toHaveBeenCalledOnce();
	});

	it("Done button is disabled when no channels are selected", async () => {
		renderDialog({ selectedChannels: [] });

		await expect.element(page.getByTestId("environments-channels-confirm")).toBeDisabled();
	});
});
