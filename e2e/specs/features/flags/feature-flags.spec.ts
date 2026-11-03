import { test } from "../../../fixtures/features/flags.js";
import { flagsData } from "../../../testdata/flags.js";

test.describe("Feature flags @smoke", () => {
	test("shows a settings section gated on a build-overridden flag and registers the flag service", async ({
		appShellPage,
		flagGatedSettingsPage,
		diagnosticsPage,
	}) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
		await flagGatedSettingsPage.verifySectionShownForFlagOn(
			flagsData.flagOn.sectionId,
			flagsData.flagOn.flag,
		);
		await diagnosticsPage.open();
		await diagnosticsPage.verifyPluginActive("kilo.flags");
		await diagnosticsPage.openServices();
		await diagnosticsPage.verifyServiceListed(flagsData.serviceKey);
	});
});
