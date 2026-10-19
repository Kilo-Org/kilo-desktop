export type SettingsSearchSection = { id: string; title: string };

/** The settings siderail filters sections by a case-insensitive title substring match. */
export const settingsSearchData = {
	placeholder: "Search settings",
	matchQuery: "NOTIF",
	noMatchQuery: "no-such-settings-section",
	matchingSection: { id: "notifications", title: "Notifications" },
	nonMatchingSections: [
		{ id: "appearance", title: "Appearance" },
		{ id: "account", title: "Account" },
		{ id: "privacy", title: "Privacy" },
	],
	twoLetterQuery: "pr",
} as const satisfies {
	placeholder: string;
	matchQuery: string;
	noMatchQuery: string;
	matchingSection: SettingsSearchSection;
	nonMatchingSections: readonly SettingsSearchSection[];
	twoLetterQuery: string;
};
