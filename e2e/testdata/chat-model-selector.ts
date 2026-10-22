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
	},
	searchPlaceholder: "Search models",
	addLocalModelButtonName: "Add a local model",
	copy: {
		noFavorites: "No favorite models yet.",
		localServerTitle: "Run AI on your device",
		localServerDescription:
			"Private local inference that keeps your prompts, outputs, and data under your control.",
	},
	/**
	 * Provider-family search terms rather than exact model ids or versions:
	 * the live Kilo Gateway catalog renames/replaces individual model
	 * versions (e.g. "gpt-5" -> "gpt-5.6") between runs, but a publisher
	 * family match stays stable. `query` can match any connected provider's
	 * model by id, name, description, or keywords (`model-search.ts`), so
	 * `publisherPrefix` pins the result to the intended family: it is the
	 * raw gateway id prefix (e.g. "anthropic/") a matching model's
	 * `kilo/<publisherPrefix>...` id must start with, since a query like
	 * "llama" can otherwise match an unrelated model whose description
	 * merely mentions Llama.
	 */
	gatewayInfoSearchTerms: [
		{ label: "Anthropic", query: "anthropic", publisherPrefix: "anthropic/" },
		{ label: "OpenAI", query: "openai", publisherPrefix: "openai/" },
		{ label: "DeepSeek", query: "deepseek", publisherPrefix: "deepseek/" },
		{ label: "xAI Grok", query: "grok", publisherPrefix: "x-ai/" },
		{ label: "Qwen", query: "qwen", publisherPrefix: "qwen/" },
		{ label: "Mistral", query: "mistral", publisherPrefix: "mistralai/" },
		{ label: "Moonshot Kimi", query: "kimi", publisherPrefix: "moonshotai/" },
		{ label: "Zhipu GLM", query: "glm", publisherPrefix: "z-ai/" },
		{ label: "Google Gemini", query: "gemini", publisherPrefix: "google/" },
		{ label: "Meta Llama", query: "llama", publisherPrefix: "meta-llama/" },
	],
	/** One representative term from the list above, for the @smoke case. */
	gatewayInfoSmokeSearchTerm: {
		label: "Anthropic",
		query: "anthropic",
		publisherPrefix: "anthropic/",
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
	 * the info tooltip (`plugins/kilo-ui/src/main/chat/gateway-model-details.ts`),
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
