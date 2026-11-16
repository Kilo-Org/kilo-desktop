import {
	click,
	expectElementToBeDisabled,
	expectElementToBeEnabled,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

const NOTEBOOK_KIND = "kilo.notebook/notebook";
const UNAVAILABLE_HINT = "Sign in to Kilo to use embedded notebooks.";

export class NotebookPage {
	private readonly launcherEntry = () => getLocatorByTestId(`launcher-pane-${NOTEBOOK_KIND}`);

	async openLauncher(): Promise<void> {
		await click(getLocatorByTestId("new-chat"));
		await expectElementToBeVisible(
			getLocatorByTestId("workbench-launcher"),
			"New session should open the launcher",
		);
	}

	async verifyNotebookAvailable(): Promise<void> {
		const entry = this.launcherEntry();
		await expectElementToBeVisible(entry, "The launcher should offer a Notebook pane");
		await expectElementToBeEnabled(entry, "A signed-in user should be able to open a notebook");
	}

	async verifyNotebookFrame(): Promise<void> {
		const view = getLocatorByTestId("session-workbench", { onlyVisible: true }).getByTestId(
			"notebook-view",
		);
		const frame = view.getByTestId("notebook-frame");
		const error = view.getByTestId("notebook-runtime-error");
		const placeholder = view.getByTestId("notebook-placeholder");
		const openError = view.getByTestId("notebook-file-open-error");
		await expectElementToBeVisible(frame.or(error).or(placeholder).or(openError), {
			message: "The notebook should finish opening or report why it could not start",
			timeout: 180_000,
		});
		for (const failure of [error, placeholder, openError]) {
			const reason = (await failure.isVisible()) ? await failure.textContent() : "No error shown";
			await expectElementToBeHidden(failure, {
				message: `The notebook should open without an error: ${reason}`,
			});
		}
		await expectElementToBeVisible(frame, "The notebook should show its embedded interface");
		await expectElementToBeVisible(
			frame.contentFrame().getByRole("button", { name: "Add code cell", exact: true }),
			{
				message: "The embedded notebook should show its code-cell control",
				timeout: 120_000,
			},
		);
	}

	async verifyNotebookNeedsSignIn(): Promise<void> {
		const entry = this.launcherEntry();
		await expectElementToBeVisible(entry, "The launcher should offer a Notebook pane");
		await expectElementToBeDisabled(
			entry,
			"A signed-out user should not be able to open a notebook",
		);
		await expectElementToHaveAttribute(entry, "title", UNAVAILABLE_HINT, {
			message: "The Notebook entry should say why it is unavailable",
		});
	}
}
