import {
	click,
	expectElementToBeDisabled,
	expectElementToBeEnabled,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

const NOTEBOOK_KIND = "kilo.notebook/notebook";
const UNAVAILABLE_HINT = "Sign in to Kilo to use embedded notebooks.";

/**
 * Page object for kilo.notebook's Notebook pane. Notebooks need a Kilo account:
 * the smoke checks the launcher's entry signed in (startable) and signed out
 * (gated). It never opens a notebook — that starts runtimed, which builds
 * kernel environments on a cold cache; the pane itself is covered by
 * kilo.notebook's Vitest browser tier.
 */
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
