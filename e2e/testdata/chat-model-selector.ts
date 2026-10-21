export const chatModelSelectorData = {
	locators: {
		triggerTestId: "kilo-model-selector-trigger",
		menuTestId: "kilo-model-selector-content",
		searchInput: '[data-slot="model-selector-search"]',
		railTestId: "kilo-model-selector-rail",
		railFavoritesTestId: "kilo-model-selector-rail-favorites",
		railLocalServerTestId: "kilo-model-selector-rail-kilo-desktop-model-server",
		listTestId: "kilo-model-selector-list",
		emptyIcon: '[data-slot="empty-icon"]',
		modelOptionTestIdPattern: /^kilo-model-option-/,
	},
	searchPlaceholder: "Search models",
	addLocalModelButtonName: "Add a local model",
	copy: {
		noFavorites: "No favorite models yet.",
		localServerTitle: "Run AI on your device",
		localServerDescription:
			"Private local inference that keeps your prompts, outputs, and data under your control.",
	},
	settleTimeoutMs: 30_000,
	railConvergeTimeoutMs: 20_000,
} as const;
