import { readFile } from "node:fs/promises";

import {
	click,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	getLocatorByRole,
	pressPageKeyboard,
	pressSequentially,
} from "@anaconda/playwright-utils";
import { expect } from "@playwright/test";

/**
 * Table viewer inside a workspace-root file's Files tab. Every open file keeps
 * its own mounted tab panel, so all lookups are scoped to that panel.
 */
export class TableViewerPage {
	private readonly filePanel = (fileName: string) =>
		getLocatorByRole("tabpanel", { name: fileName });

	private readonly tableView = (fileName: string) =>
		this.filePanel(fileName).getByRole("region", { name: `Table view of ${fileName}` });

	private readonly grid = (fileName: string) =>
		this.tableView(fileName).getByRole("grid", { name: "Data table" });

	private readonly tableError = (fileName: string) =>
		this.filePanel(fileName).getByTestId("files-table-error");

	async verifyTableIsLoaded(fileName: string): Promise<void> {
		// Rows mount only after the whole file decoded, so a grid means Sift's
		// chunk, stylesheet and (for binary formats) WASM all loaded.
		const error = this.tableError(fileName);
		await expectElementToBeVisible(this.grid(fileName).or(error), {
			message: `${fileName} should settle as a table`,
		});
		if (await error.isVisible()) {
			throw new Error(
				`${fileName} did not load as a table: ${(await error.textContent())?.trim()}`,
			);
		}
		await expectElementToHaveAttribute(this.tableView(fileName), "aria-busy", "false", {
			message: `${fileName} should finish loading as a table`,
		});
	}

	async verifyCellIsShown(fileName: string, text: string): Promise<void> {
		await expectElementToBeVisible(
			this.grid(fileName).getByRole("gridcell", { name: text, exact: true }),
			`${fileName} should show a "${text}" cell`,
		);
	}

	async verifyTableIsReadOnly(fileName: string): Promise<void> {
		await expectElementToBeHidden(
			this.filePanel(fileName).getByTestId("files-table-toggle"),
			"A read-only table should not offer a source toggle",
		);
		await expectElementToBeHidden(
			this.filePanel(fileName).getByTestId("files-save"),
			"A read-only table should not offer Save",
		);
	}

	async replaceSourceAndShowTable(fileName: string, contents: string): Promise<void> {
		const panel = this.filePanel(fileName);
		await click(panel.getByRole("button", { name: "Edit source" }));
		const editor = panel.getByRole("textbox", { name: fileName });
		await click(editor);
		await pressPageKeyboard("ControlOrMeta+A");
		await pressSequentially(editor, contents);
		await click(panel.getByRole("button", { name: "Show as table" }));
	}

	async saveFile(fileName: string): Promise<void> {
		const save = this.filePanel(fileName).getByTestId("files-save");
		await click(save);
		await expectElementToBeHidden(save, "Save should clear once the draft is written");
	}

	async verifyFileContents(filePath: string, contents: string): Promise<void> {
		await expect
			.poll(() => readFile(filePath, "utf8"), {
				message: "The saved file should hold the draft shown in the table",
			})
			.toBe(contents);
	}
}
