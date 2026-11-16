export type SettingsSearchSection = { id: string; title: string };

/** The settings siderail filters sections by a case-insensitive title substring match. */
export const settingsSearchData = {
	placeholder: "Search settings",
	matchQuery: "APPEAR",
	noMatchQuery: "no-such-settings-section",
	matchingSection: { id: "appearance", title: "Appearance" },
	nonMatchingSections: [
		{ id: "keyboard-shortcuts", title: "Shortcuts" },
		{ id: "privacy", title: "Privacy" },
	],
	twoLetterQuery: "ap",
} as const satisfies {
	placeholder: string;
	matchQuery: string;
	noMatchQuery: string;
	matchingSection: SettingsSearchSection;
	nonMatchingSections: readonly SettingsSearchSection[];
	twoLetterQuery: string;
};
