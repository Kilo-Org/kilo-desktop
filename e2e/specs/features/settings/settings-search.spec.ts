import { test } from "../../../fixtures/features/settings-search.js";
import { settingsSearchData } from "../../../testdata/settings-search.js";

const {
	placeholder,
	matchQuery,
	noMatchQuery,
	matchingSection,
	nonMatchingSections,
	twoLetterQuery,
} = settingsSearchData;

test.describe("Settings search", () => {
	test.beforeEach(async ({ appShellPage }) => {
		await appShellPage.verifyShellIsLoaded();
		await appShellPage.openSettings();
	});

	test("verifies search with valid data", async ({ settingsSearchPage }) => {
		await settingsSearchPage.enterSearchQuery(matchQuery);
		await settingsSearchPage.verifySectionEntryVisible(matchingSection);
		for (const section of nonMatchingSections) {
			await settingsSearchPage.verifySectionEntryHidden(section);
		}
	});

	test("verifies search with two-letter data", async ({ settingsSearchPage }) => {
		await settingsSearchPage.enterSearchQuery(twoLetterQuery);
		await settingsSearchPage.verifyAllSearchResultsContainQuery(twoLetterQuery);
	});

	test("verifies search with invalid data", async ({ settingsSearchPage }) => {
		await settingsSearchPage.enterSearchQuery(noMatchQuery);
		await settingsSearchPage.verifySectionNavHidden();
		await settingsSearchPage.verifySearchFieldVisible();
	});

	test("verifies clearing search with the clear icon", async ({ settingsSearchPage }) => {
		await settingsSearchPage.enterSearchQuery(matchQuery);
		await settingsSearchPage.verifySectionEntryHidden(nonMatchingSections[0]);
		await settingsSearchPage.clickClearSearchIcon();
		await settingsSearchPage.verifySearchValue("");
		await settingsSearchPage.verifySearchPlaceholder(placeholder);
		await settingsSearchPage.verifySectionEntryVisible(matchingSection);
		for (const section of nonMatchingSections) {
			await settingsSearchPage.verifySectionEntryVisible(section);
		}
	});
});
