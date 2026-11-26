export const chatModelSelectorData = {
	locators: {
		triggerTestId: "kilo-model-selector-trigger",
		menuTestId: "kilo-model-selector-content",
		searchInput: '[data-slot="model-selector-search"]',
		railTestId: "kilo-model-selector-rail",
		railFavoritesTestId: "kilo-model-selector-rail-favorites",
		railLocalServerTestId: "kilo-model-selector-rail-kilo-desktop-model-server",
		railKiloGatewayTestId: "kilo-model-selector-rail-kilo",
		listTestId: "kilo-model-selector-list",
		emptyIcon: '[data-slot="empty-icon"]',
		modelOptionTestIdPattern: /^kilo-model-option-/,
		// Model option rows carry no test id for the plain name text alone.
		modelOptionName: ".truncate.text-sm.leading-5.font-normal",
		infoIconTestIdPrefix: "kilo-model-info-",
		infoPopoverTestIdPrefix: "kilo-model-info-popover-",
		popoverTitle: '[data-slot="popover-title"]',
		popoverDescription: '[data-slot="popover-description"]',
		popoverRiskMeter: '[role="meter"]',
		// `dt`/`dd` fact pairs carry no stable attribute — last resort structural scoping.
		factRow: "dl > div",
		factLabel: "dl > div > dt",
		factValue: "dd",
		favoriteButtonTestIdPrefix: "kilo-model-favorite-",
	},
	searchPlaceholder: "Search models",
	addLocalModelButtonName: "Add a local model",
	copy: {
		noFavorites: "No favorite models yet.",
		localServerTitle: "Run AI on your device",
		localServerDescription:
			"Private local inference that keeps your prompts, outputs, and data under your control.",
	},
	/** Favorite star button's two accessible-name states (kilo-model-selector.tsx). */
	favoriteCopy: {
		addLabel: "Add to favorites",
		removeLabel: "Remove from favorites",
		// Active-star styling (StarIcon className when favorited).
		activeClass: /^(?=.*\bfill-current\b)(?=.*\btext-yellow-500\b).*$/,
	},
	/**
	 * Fixed UI copy the tooltip renders around dynamic, API-sourced model
	 * data. Spelling coverage is scoped to this static copy only — model
	 * names/descriptions come from the live Kilo Gateway catalog and are not
	 * under this app's control.
	 */
	gatewayInfoCopy: {
		enkryptLabel: "Enkrypt risk score",
		enkryptSubLabel: "Lower is safer",
		viewOnKiloLinkText: "View on Kilo",
		viewOnKiloLinkHrefPrefix: "https://kilo.ai/models/",
		factLabels: [
			"Input",
			"Output",
			"Avg. attempt",
			"Context",
			"Max output",
			"Billing",
			"Prompt training",
		],
		contextFactLabel: "Context",
		maxOutputFactLabel: "Max output",
		promptTrainingFactLabel: "Prompt training",
		promptTrainingMay: "May",
		promptTrainingNo: "No",
	},
	/**
	 * Same gateway enrichment endpoint the app itself reads when it renders
	 * the info tooltip (kilo.core's `plugins/core/src/main/models/gateway-catalog.ts`),
	 * fetched independently here as a ground-truth oracle so the tooltip
	 * assertions compare against real expected values instead of only
	 * checking that *some* text is present. Only `description`, `context_length`,
	 * `top_provider.max_completion_tokens`, and `mayTrainOnYourPrompts` are
	 * checked exactly: pricing/Billing facts also depend on the signed-in
	 * user's own BYOK key state, which this public endpoint does not expose.
	 */
	gatewayModelDetailsUrl: "https://app.kilo.ai/api/gateway/models",
	settleTimeoutMs: 30_000,
	railConvergeTimeoutMs: 20_000,
} as const;
