import { expectElementToBeVisible, getLocatorByTestId } from "@anaconda/playwright-utils";

/**
 * Settings sections contributed with a `kilo.flags/flag:<key>` `when`: the
 * observable result of kilo.flags turning its flags into context keys.
 */
export class FlagGatedSettingsPage {
	private readonly sectionEntry = (id: string) => getLocatorByTestId(`settings-section-${id}`);

	async verifySectionShownForFlagOn(sectionId: string, flag: string): Promise<void> {
		await expectElementToBeVisible(
			this.sectionEntry(sectionId),
			`Settings should list "${sectionId}" while the "${flag}" flag is on`,
		);
	}
}
