import {
	click,
	expect,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToHaveAttribute,
	expectElementToHaveText,
	expectElementToHaveValue,
	fill,
	getAllTexts,
	getLocatorByTestId,
} from "@anaconda/playwright-utils";

import type { SettingsSearchSection } from "../../testdata/settings-search.js";

// Inset of the native `type="search"` cancel (×) button's centre from the input's right edge.
const CLEAR_ICON_RIGHT_INSET_PX = 8;

export class SettingsSearchPage {
	private readonly sidebar = () => getLocatorByTestId("settings-sidebar");
	private readonly searchInput = () => getLocatorByTestId("settings-search");
	private readonly sectionNav = () => getLocatorByTestId("settings-section-nav");
	private readonly sectionEntry = (id: string) => getLocatorByTestId(`settings-section-${id}`);
	private readonly sectionEntries = () =>
		this.sectionNav().locator('[data-qa-id^="settings-section-"]');

	async enterSearchQuery(query: string): Promise<void> {
		await fill(this.searchInput(), query);
	}

	/**
	 * The × is Chromium's built-in cancel button for `type="search"` inputs — a shadow-DOM
	 * pseudo-element no locator can target — so it is clicked by position inside the input.
	 */
	async clickClearSearchIcon(): Promise<void> {
		const box = await this.searchInput().boundingBox();
		expect(
			box,
			"Settings search field should be rendered so its clear icon can be clicked",
		).not.toBeNull();
		const { width, height } = box!;
		await click(this.searchInput(), {
			position: { x: width - CLEAR_ICON_RIGHT_INSET_PX, y: height / 2 },
		});
	}

	async verifySectionEntryVisible(section: SettingsSearchSection): Promise<void> {
		await expectElementToBeVisible(
			this.sectionEntry(section.id),
			`"${section.title}" should be visible in the settings siderail`,
		);
		await expectElementToHaveText(this.sectionEntry(section.id), section.title, {
			message: `"${section.title}" should be listed in the settings siderail`,
		});
	}

	async verifySectionEntryHidden(section: SettingsSearchSection): Promise<void> {
		await expectElementToBeHidden(
			this.sectionEntry(section.id),
			`"${section.title}" should be filtered out of the settings siderail`,
		);
	}

	async verifySectionNavHidden(): Promise<void> {
		await expectElementToBeHidden(
			this.sectionNav(),
			"Settings section list should be hidden when no section matches the search",
		);
	}

	async verifySearchFieldVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.sidebar(),
			"Settings siderail should stay visible so the user can correct the search",
		);
		await expectElementToBeVisible(
			this.searchInput(),
			"Settings search field should stay visible so the user can correct the search",
		);
	}

	async verifySearchValue(query: string): Promise<void> {
		await expectElementToHaveValue(this.searchInput(), query, {
			message: `Settings search field should contain "${query}"`,
		});
	}

	async verifySearchPlaceholder(placeholder: string): Promise<void> {
		await expectElementToHaveAttribute(this.searchInput(), "placeholder", placeholder, {
			message: `Settings search field should show the "${placeholder}" placeholder`,
		});
	}

	/** The siderail filter is a case-insensitive substring match on the section title. */
	async verifyAllSearchResultsContainQuery(query: string): Promise<void> {
		const titles = await getAllTexts(this.sectionEntries());
		expect(
			titles.length,
			`No settings sections listed for "${query}"; expected at least one match`,
		).toBeGreaterThan(0);
		const nonMatching = titles.filter(
			(title) => !title.toLowerCase().includes(query.toLowerCase()),
		);
		expect(
			nonMatching,
			`Every listed section should contain "${query}", but ${nonMatching.length} did not: ${nonMatching.join(", ")}`,
		).toHaveLength(0);
	}
}
