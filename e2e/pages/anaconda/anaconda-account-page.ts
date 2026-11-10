import {
	expectElementToBeVisible,
	expectElementToHaveText,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

export class AnacondaAccountPage {
	private readonly row = () => getLocatorByTestId("account-anaconda-row");
	private readonly status = () => getLocatorByTestId("account-anaconda-status");
	private readonly signIn = () => getLocatorByTestId("account-anaconda-sign-in");

	/**
	 * The panel ships behind the `local-model-catalog` flag, which `package:e2e`
	 * enables. Packaged e2e also sets ANACONDA_SKIP_KEYRING, so no host Anaconda
	 * key is inherited and the panel resolves to its signed-out state.
	 */
	async verifySignedOutRow(): Promise<void> {
		await expectElementToBeVisible(this.row(), "Account settings should show the Anaconda row");
		await expectElementToHaveText(this.status(), "Not signed in.", {
			message: "The Anaconda row should report no stored API key",
		});
		await expectElementToBeVisible(this.signIn(), "The Anaconda row should offer Sign in");
	}
}
