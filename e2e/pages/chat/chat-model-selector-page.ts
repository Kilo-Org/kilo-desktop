import { expect } from "@playwright/test";
import type { Locator } from "@playwright/test";
import {
	click,
	clickByJS,
	expectElementToBeHidden,
	expectElementToBeVisible,
	expectElementToContainText,
	expectElementToHaveAttribute,
	expectElementToHaveClass,
	expectElementToHaveCount,
	expectElementToHaveText,
	fill,
	getAllTexts,
	getAttribute,
	getLocator,
	getLocatorByRole,
	getLocatorByTestId,
	getLocatorByText,
	getLocatorCount,
	getRequest,
	getText,
	isElementVisible,
	pressLocatorKeyboard,
} from "@anaconda/playwright-utils";
import { getPage } from "@anaconda/playwright-utils/page-utils";

import { KILO_GATEWAY_STUB_URL_ENV } from "../../utils/app-launcher.js";
import { packagedServerLine } from "../../utils/kilo-server-line.js";
import { chatModelSelectorData } from "../../testdata/chat/model-selector.js";

const MODEL_OPTION_TEST_ID_PREFIX = "kilo-model-option-";
const KILO_PROVIDER_PREFIX = "kilo/";
const GATEWAY_MODEL_CATALOG_PATH = "/api/openrouter/models";
const ENRICHMENT_CONVERGE_TIMEOUT_MS = 20_000;

/**
 * Ground truth for the fields the info tooltip can show deterministically.
 * Pricing/Billing facts also depend on the signed-in user's own BYOK key
 * state, which this public endpoint does not expose, so they are left out.
 */
type GatewayModelGroundTruth = {
	description: string;
	contextWindowTokens: number | undefined;
	maxOutputTokens: number | undefined;
	mayTrainOnYourPrompts: boolean | undefined;
};

/**
 * Mirrors the `z.number().int().positive()` the production parser applies to
 * `context_length`/`max_completion_tokens` (kilo.core's `gateway-catalog.ts`)
 * — a zero or negative limit is dropped there, so the oracle must drop it too
 * instead of expecting a fact the app correctly omits.
 */
function positiveInteger(value: unknown): number | undefined {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

/** Mirrors `formatTokenLimit` in kilo-model-selector.tsx so expected facts match exactly. */
function formatTokenLimit(value: number): string {
	return new Intl.NumberFormat("en-US", {
		notation: "compact",
		maximumFractionDigits: value >= 1_000_000 ? 2 : 0,
	}).format(value);
}

/**
 * Composer model ("Select model") selector.
 *
 * Visibility coverage (trigger, menu shell, provider rail, search box, empty
 * states) runs against the packaged app's own UI shell and needs no gateway
 * catalog. The Kilo Gateway model-info tooltip coverage below instead relies
 * on the e2e Kilo Gateway stub's one-time snapshot of the real catalog
 * (`utils/kilo-gateway-stub.ts`), so it searches by provider-family term
 * (see `chatModelSelectorData.gatewayInfoSearchTerms`) rather than asserting
 * on a specific model id, which the live catalog can rename or retire.
 * Selecting a model, favorites toggling, and persistence remain out of scope.
 */
export class ChatModelSelectorPage {
	private readonly trigger = () => getLocatorByTestId(chatModelSelectorData.locators.triggerTestId);
	private readonly menu = () => getLocatorByTestId(chatModelSelectorData.locators.menuTestId);
	/** Base UI marks a popup `data-closed` while its exit animation runs. */
	private readonly closingMenu = () => this.menu().and(getLocator("[data-closed]"));
	private readonly searchInput = () => getLocator(chatModelSelectorData.locators.searchInput);
	private readonly rail = () => getLocatorByTestId(chatModelSelectorData.locators.railTestId);
	private readonly railFavorites = () =>
		getLocatorByTestId(chatModelSelectorData.locators.railFavoritesTestId);
	private readonly railLocalServer = () =>
		getLocatorByTestId(chatModelSelectorData.locators.railLocalServerTestId);
	private readonly railKiloGateway = () =>
		getLocatorByTestId(chatModelSelectorData.locators.railKiloGatewayTestId);
	private readonly list = () => getLocatorByTestId(chatModelSelectorData.locators.listTestId);
	private readonly modelOptions = () =>
		getLocatorByTestId(chatModelSelectorData.locators.modelOptionTestIdPattern);
	private readonly modelOption = (modelId: string) =>
		getLocatorByTestId(`${MODEL_OPTION_TEST_ID_PREFIX}${modelId}`);
	private readonly emptyIcon = () => this.menu().locator(chatModelSelectorData.locators.emptyIcon);
	private readonly addLocalModelButton = () =>
		getLocatorByRole("button", { name: chatModelSelectorData.addLocalModelButtonName });
	private readonly favoriteButton = (modelId: string) =>
		getLocatorByTestId(`${chatModelSelectorData.locators.favoriteButtonTestIdPrefix}${modelId}`);
	private readonly favoritesListModelName = (modelName: string) =>
		this.list().locator(chatModelSelectorData.locators.modelOptionName).getByText(modelName, {
			exact: true,
		});
	private readonly infoIcon = (modelId: string) =>
		getLocatorByTestId(`${chatModelSelectorData.locators.infoIconTestIdPrefix}${modelId}`);
	private readonly infoPopover = (modelId: string) =>
		getLocatorByTestId(`${chatModelSelectorData.locators.infoPopoverTestIdPrefix}${modelId}`);
	private readonly popoverTitle = (modelId: string) =>
		this.infoPopover(modelId).locator(chatModelSelectorData.locators.popoverTitle);
	private readonly popoverDescription = (modelId: string) =>
		this.infoPopover(modelId).locator(chatModelSelectorData.locators.popoverDescription);
	private readonly popoverRiskMeter = (modelId: string) =>
		this.infoPopover(modelId).locator(chatModelSelectorData.locators.popoverRiskMeter);
	private readonly popoverFactLabels = (modelId: string) =>
		this.infoPopover(modelId).locator(chatModelSelectorData.locators.factLabel);
	private readonly popoverFactValue = (modelId: string, label: string) =>
		this.infoPopover(modelId)
			.locator(chatModelSelectorData.locators.factRow)
			.filter({ has: getLocatorByText(label, { exact: true }) })
			.locator(chatModelSelectorData.locators.factValue);
	// Located by its `href` prefix, not its visible text — a locator that
	// matches on the expected text would simply find nothing (and the check
	// would be silently skipped) if the link's own label had a typo.
	private readonly popoverViewOnKiloLink = (modelId: string) =>
		this.infoPopover(modelId).locator(
			`a[href^="${chatModelSelectorData.gatewayInfoCopy.viewOnKiloLinkHrefPrefix}"]`,
		);

	/**
	 * The trigger is a toggle, not an open-only control: a prior test leaving
	 * the menu open (e.g. a bare visibility check with no closing step) would
	 * make this click close it instead, so every later step would silently
	 * act against a closed menu. Only click when the menu is not already
	 * open, so this stays safe to call unconditionally at the start of a test.
	 * A menu an earlier test left open closes, animated, on the next outside
	 * press (e.g. New session) and stays visible meanwhile, so that close is
	 * awaited before deciding: rails clicked during it vanish mid-test.
	 */
	async openModelSelector(): Promise<void> {
		await expectElementToBeHidden(
			this.closingMenu(),
			"A closing model selector should finish closing",
		);
		if (await isElementVisible(this.menu())) return;
		await this.waitForTriggerSettled();
		await click(this.trigger());
	}

	async selectFavorites(): Promise<void> {
		await this.selectRail(this.railFavorites());
	}

	async selectLocalModelServer(): Promise<void> {
		await this.selectRail(this.railLocalServer());
	}

	async closeWithEscape(): Promise<void> {
		await pressLocatorKeyboard(this.searchInput(), "Escape");
	}

	async selectKiloGateway(): Promise<void> {
		await this.selectRail(this.railKiloGateway());
	}

	/** Selects a custom provider's rail entry by the provider id its name slugifies to (`kilo-model-selector-rail-<providerId>`, same pattern as the built-in Favorites/Local Server/Kilo Gateway rails above). */
	async selectCustomProviderRail(providerId: string): Promise<void> {
		await this.selectRail(getLocatorByTestId(`kilo-model-selector-rail-${providerId}`));
	}

	/** Clicks a model option by its full id (`<providerId>/<modelId>`) once its rail is already selected and the option is visible. */
	async selectModel(modelId: string): Promise<void> {
		await click(this.modelOption(modelId));
	}

	async searchModels(query: string): Promise<void> {
		await fill(this.searchInput(), query);
	}

	/**
	 * Resolves a publisher model from the catalog, then narrows search so its
	 * virtualized row mounts. Requires `"tools"` in `supported_parameters`:
	 * the Kilo CLI's own provider list drops non-tool-calling models (e.g.
	 * `meta-llama/llama-guard-4-12b`, a content-safety classifier) before
	 * this app ever sees them, so the raw gateway catalog's first
	 * publisher-prefix match is not always one the picker actually renders.
	 */
	async getPublisherModelId(publisherPrefix: string): Promise<string> {
		const model = (await this.pickableGatewayModels()).find((candidate) =>
			candidate.id.startsWith(publisherPrefix),
		);
		if (!model || typeof model.id !== "string") {
			throw new Error(
				`Kilo Gateway catalog has no tool-calling model for publisher "${publisherPrefix}"`,
			);
		}
		const modelId = `${KILO_PROVIDER_PREFIX}${model.id}`;
		await this.searchModels(model.id);
		const option = this.modelOption(modelId);
		await expectElementToBeVisible(
			option,
			`Model search should mount the "${publisherPrefix}" Kilo Gateway model "${model.id}"`,
		);
		const testId = await getAttribute(option, "data-qa-id");
		if (!testId?.startsWith(MODEL_OPTION_TEST_ID_PREFIX)) {
			throw new Error(`Expected a "${MODEL_OPTION_TEST_ID_PREFIX}<id>" test id, got "${testId}"`);
		}
		return testId.slice(MODEL_OPTION_TEST_ID_PREFIX.length);
	}

	/**
	 * `count` publisher search terms whose models the signed-out picker lists.
	 * The v1 line lists the whole Kilo Gateway catalog, so the terms are the
	 * fixed publisher families above; Kilo v2 lists only free models to a
	 * signed-out user, so its terms are the publishers of the free,
	 * tool-calling models in the catalog the stub captured.
	 */
	async gatewaySearchTerms(
		count: number,
	): Promise<ReadonlyArray<{ readonly query: string; readonly publisherPrefix: string }>> {
		if (packagedServerLine() === "v1") {
			return chatModelSelectorData.gatewayInfoSearchTerms.slice(0, count);
		}
		const publishers = new Set(
			(await this.pickableGatewayModels()).map((model) => model.id.split("/")[0]!),
		);
		const terms = [...publishers]
			.slice(0, count)
			.map((publisher) => ({ query: publisher, publisherPrefix: `${publisher}/` }));
		if (terms.length < count) {
			throw new Error(`The Kilo Gateway catalog has fewer than ${count} free model publishers`);
		}
		return terms;
	}

	/** One representative publisher search term, for the @smoke case. */
	async gatewaySmokeSearchTerm(): Promise<{
		readonly query: string;
		readonly publisherPrefix: string;
	}> {
		if (packagedServerLine() === "v1") return chatModelSelectorData.gatewayInfoSmokeSearchTerm;
		const [term] = await this.gatewaySearchTerms(1);
		if (!term) throw new Error("The Kilo Gateway catalog has no free model publisher");
		return term;
	}

	/**
	 * The catalog models the picker can show signed out: tool-calling ones,
	 * since the Kilo CLI drops the rest, and on Kilo v2 only free ones.
	 */
	private async pickableGatewayModels(): Promise<ReadonlyArray<{ readonly id: string }>> {
		const gatewayUrl = process.env[KILO_GATEWAY_STUB_URL_ENV];
		if (!gatewayUrl) {
			throw new Error("Kilo Gateway stub URL is unavailable in the e2e environment");
		}
		const response = await getRequest(`${gatewayUrl}${GATEWAY_MODEL_CATALOG_PATH}`);
		expect(response.ok(), "Kilo Gateway catalog endpoint should respond with 2xx").toBeTruthy();
		const payload = (await response.json()) as { data: ReadonlyArray<Record<string, unknown>> };
		const freeOnly = packagedServerLine() === "v2";
		return payload.data.filter(
			(candidate): candidate is Record<string, unknown> & { id: string } =>
				typeof candidate.id === "string" &&
				Array.isArray(candidate.supported_parameters) &&
				candidate.supported_parameters.includes("tools") &&
				(!freeOnly || candidate.isFree === true),
		);
	}

	async getPublisherModelName(modelId: string): Promise<string> {
		return await getText(
			this.modelOption(modelId).locator(chatModelSelectorData.locators.modelOptionName),
		);
	}

	async toggleFavorite(modelId: string): Promise<void> {
		await click(this.favoriteButton(modelId));
	}

	/**
	 * Favorites `modelId` unless it already is. Favorites outlive a test in the
	 * worker's app profile, so a toggle could unfavorite a model an earlier
	 * test on the same worker favorited.
	 */
	async favorite(modelId: string): Promise<void> {
		const label = await this.favoriteButton(modelId).getAttribute("aria-label");
		if (label !== chatModelSelectorData.favoriteCopy.removeLabel)
			await this.toggleFavorite(modelId);
	}

	/**
	 * Independently fetches the same Kilo Gateway enrichment endpoint the app
	 * reads (kilo.core's `gateway-catalog.ts`) and returns the fields the info
	 * tooltip should show for `modelId` (a `kilo/<rawGatewayId>` id, as read
	 * from `getPublisherModelId`). This is the test's own oracle, so
	 * tooltip assertions compare against a real expected value instead of
	 * only checking that a description/fact is present.
	 */
	async fetchGatewayModelGroundTruth(modelId: string): Promise<GatewayModelGroundTruth> {
		const rawModelId = modelId.startsWith(KILO_PROVIDER_PREFIX)
			? modelId.slice(KILO_PROVIDER_PREFIX.length)
			: modelId;
		const response = await getRequest(chatModelSelectorData.gatewayModelDetailsUrl);
		expect(
			response.ok(),
			"Kilo Gateway model details endpoint should respond with 2xx",
		).toBeTruthy();
		const payload = (await response.json()) as { data: ReadonlyArray<Record<string, unknown>> };
		const entry = payload.data.find((candidate) => candidate.id === rawModelId);
		if (!entry) {
			throw new Error(`Kilo Gateway model details endpoint has no entry for "${rawModelId}"`);
		}
		const gatewayUrl = process.env[KILO_GATEWAY_STUB_URL_ENV];
		if (!gatewayUrl) {
			throw new Error("Kilo Gateway stub URL is unavailable in the e2e environment");
		}
		const catalogResponse = await getRequest(`${gatewayUrl}${GATEWAY_MODEL_CATALOG_PATH}`);
		expect(
			catalogResponse.ok(),
			"Kilo Gateway catalog endpoint should respond with 2xx",
		).toBeTruthy();
		const catalogPayload = (await catalogResponse.json()) as {
			data: ReadonlyArray<Record<string, unknown>>;
		};
		const catalogEntry = catalogPayload.data.find((candidate) => candidate.id === rawModelId);
		if (!catalogEntry) {
			throw new Error(`Kilo Gateway catalog endpoint has no entry for "${rawModelId}"`);
		}
		const catalogDescription =
			typeof catalogEntry.description === "string" ? catalogEntry.description.trim() : "";
		const topProvider = entry.top_provider as { max_completion_tokens?: unknown } | undefined;
		return {
			description:
				typeof entry.description === "string" && entry.description !== ""
					? entry.description
					: catalogDescription,
			contextWindowTokens: positiveInteger(entry.context_length),
			maxOutputTokens: positiveInteger(topProvider?.max_completion_tokens),
			mayTrainOnYourPrompts:
				typeof entry.mayTrainOnYourPrompts === "boolean" ? entry.mayTrainOnYourPrompts : undefined,
		};
	}

	async openModelInfo(modelId: string): Promise<void> {
		await click(this.infoIcon(modelId));
	}

	async closeModelInfo(modelId: string): Promise<void> {
		await pressLocatorKeyboard(this.infoIcon(modelId), "Escape");
	}

	async verifyTriggerVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.trigger(),
			"Composer should show the model selector trigger",
		);
	}

	async verifyMenuOpen(): Promise<void> {
		await expectElementToBeVisible(this.menu(), "Model selector menu should be open");
	}

	async verifyMenuClosed(): Promise<void> {
		await expectElementToBeHidden(this.menu(), "Model selector menu should be closed");
	}

	async verifyRailVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.rail(),
			"Model selector menu should show the provider rail",
		);
	}

	async verifyFavoritesButtonVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.railFavorites(),
			"Provider rail should show the Favorites button",
		);
	}

	async verifySearchVisible(): Promise<void> {
		await expectElementToBeVisible(
			this.searchInput(),
			"Model selector menu should show the search box",
		);
	}

	async verifySearchPlaceholder(): Promise<void> {
		await expectElementToHaveAttribute(
			this.searchInput(),
			"placeholder",
			chatModelSelectorData.searchPlaceholder,
			{
				message: `Model search box should be labelled "${chatModelSelectorData.searchPlaceholder}"`,
			},
		);
	}

	async verifyFavoritesEmptyMessage(): Promise<void> {
		await expectElementToBeVisible(
			this.list().getByText(chatModelSelectorData.copy.noFavorites),
			`Favorites list should show only "${chatModelSelectorData.copy.noFavorites}"`,
		);
		await expectElementToHaveCount(this.modelOptions(), 0, {
			message: "Favorites list should render no model rows",
		});
	}

	/**
	 * Favoriting has no dedicated boolean attribute (no `aria-pressed`/
	 * `data-favorite`), so both signals the app actually exposes are checked:
	 * the accessible name flips to "Remove from favorites", and the star
	 * icon itself picks up the active fill/yellow class.
	 */
	async verifyModelFavorited(modelId: string): Promise<void> {
		await expectElementToHaveAttribute(
			this.favoriteButton(modelId),
			"aria-label",
			chatModelSelectorData.favoriteCopy.removeLabel,
			{
				message: `Favorite button for "${modelId}" should flip to "${chatModelSelectorData.favoriteCopy.removeLabel}" once favorited`,
			},
		);
		await expectElementToHaveClass(
			this.favoriteButton(modelId).locator("svg"),
			chatModelSelectorData.favoriteCopy.activeClass,
			{
				message: `Favorite star for "${modelId}" should turn active (filled/yellow) once favorited`,
			},
		);
	}

	async verifyModelInFavoritesList(modelName: string): Promise<void> {
		await expectElementToBeVisible(
			this.favoritesListModelName(modelName),
			`Favorites list should show "${modelName}"`,
		);
	}

	async verifyLocalServerEmptyState(): Promise<void> {
		await expectElementToBeVisible(
			this.emptyIcon(),
			"Local Model Server empty state should show an icon",
		);
		await expectElementToBeVisible(
			this.menu().getByText(chatModelSelectorData.copy.localServerTitle),
			`Local Model Server empty state should show "${chatModelSelectorData.copy.localServerTitle}"`,
		);
		await expectElementToBeVisible(
			this.menu().getByText(chatModelSelectorData.copy.localServerDescription),
			"Local Model Server empty state should show its description",
		);
		await expectElementToBeVisible(
			this.addLocalModelButton(),
			`Local Model Server empty state should show the "${chatModelSelectorData.addLocalModelButtonName}" button`,
		);
	}

	async verifyModelInfoOpen(modelId: string): Promise<void> {
		await expectElementToBeVisible(
			this.infoPopover(modelId),
			`Info popover for model "${modelId}" should open`,
		);
	}

	async verifyModelInfoClosed(modelId: string): Promise<void> {
		await expectElementToBeHidden(
			this.infoPopover(modelId),
			`Info popover for model "${modelId}" should close`,
		);
	}

	/**
	 * Enrichment (description, facts) loads via a second query that only
	 * starts once the model catalog resolves, so it can still be in flight
	 * when the popover first opens. Asserting the exact expected description
	 * — with a wait budget longer than the default expect timeout — lets
	 * Playwright's built-in retrying poll until enrichment lands instead of
	 * failing on a legitimate, momentary loading state.
	 */
	async verifyModelInfoTitleAndDescription(
		modelId: string,
		modelName: string,
		groundTruth: GatewayModelGroundTruth,
	): Promise<void> {
		await expectElementToHaveText(this.popoverTitle(modelId), modelName, {
			message: `Info popover title should show the exact model name "${modelName}", not a title that merely contains it`,
		});
		await expectElementToHaveText(this.popoverDescription(modelId), groundTruth.description, {
			message: `Info popover for "${modelId}" should show its real gateway description, not a fallback or another model's`,
			timeout: ENRICHMENT_CONVERGE_TIMEOUT_MS,
		});
	}

	/**
	 * Every fact label the fixed UI renders must come from the static,
	 * known-spelling set — a typo or a relabeled fact would introduce one
	 * that is not in `gatewayInfoCopy.factLabels` — and, where the ground
	 * truth endpoint reports a value, the fact's own value must match it
	 * exactly rather than merely being present.
	 *
	 * Facts render only once the enrichment query (separate from, and later
	 * than, catalog readiness) resolves, so an empty facts grid immediately
	 * after opening the popover is a legitimate, momentary loading state —
	 * retry reading the labels rather than failing on the first read.
	 */
	async verifyModelInfoFacts(modelId: string, groundTruth: GatewayModelGroundTruth): Promise<void> {
		let labels: string[] = [];
		await expect(async () => {
			labels = await getAllTexts(this.popoverFactLabels(modelId));
			expect(
				labels.length,
				`Info popover for "${modelId}" should show at least one fact`,
			).toBeGreaterThan(0);
		}).toPass({ timeout: ENRICHMENT_CONVERGE_TIMEOUT_MS });
		for (const label of labels) {
			expect(
				chatModelSelectorData.gatewayInfoCopy.factLabels as readonly string[],
				`Fact label "${label}" for "${modelId}" should match the app's known-spelling copy`,
			).toContain(label);
		}
		const copy = chatModelSelectorData.gatewayInfoCopy;
		if (groundTruth.contextWindowTokens !== undefined) {
			await this.verifyModelInfoFactValue(
				modelId,
				copy.contextFactLabel,
				`${formatTokenLimit(groundTruth.contextWindowTokens)} tokens`,
			);
		}
		if (groundTruth.maxOutputTokens !== undefined) {
			await this.verifyModelInfoFactValue(
				modelId,
				copy.maxOutputFactLabel,
				`${formatTokenLimit(groundTruth.maxOutputTokens)} tokens`,
			);
		}
		if (groundTruth.mayTrainOnYourPrompts !== undefined) {
			await this.verifyModelInfoFactValue(
				modelId,
				copy.promptTrainingFactLabel,
				groundTruth.mayTrainOnYourPrompts ? copy.promptTrainingMay : copy.promptTrainingNo,
			);
		}
	}

	private async verifyModelInfoFactValue(
		modelId: string,
		label: string,
		expectedValue: string,
	): Promise<void> {
		await expectElementToHaveText(this.popoverFactValue(modelId, label), expectedValue, {
			message: `Info popover "${label}" fact for "${modelId}" should read "${expectedValue}"`,
			timeout: ENRICHMENT_CONVERGE_TIMEOUT_MS,
		});
	}

	/**
	 * The risk meter and "View on Kilo" link only render for models with
	 * curated Enkrypt/model-page data, which the live catalog does not
	 * guarantee for an arbitrary provider-family match — so these are
	 * checked only when present, never required.
	 */
	async verifyModelInfoOptionalCopySpelledCorrectly(modelId: string): Promise<void> {
		if (await isElementVisible(this.popoverRiskMeter(modelId))) {
			await expectElementToBeVisible(
				this.infoPopover(modelId).getByText(chatModelSelectorData.gatewayInfoCopy.enkryptLabel),
				`Info popover for "${modelId}" should label its risk meter "${chatModelSelectorData.gatewayInfoCopy.enkryptLabel}"`,
			);
			await expectElementToBeVisible(
				this.infoPopover(modelId).getByText(chatModelSelectorData.gatewayInfoCopy.enkryptSubLabel),
				`Info popover for "${modelId}" should sub-label its risk meter "${chatModelSelectorData.gatewayInfoCopy.enkryptSubLabel}"`,
			);
		}
		if (await isElementVisible(this.popoverViewOnKiloLink(modelId))) {
			await expectElementToContainText(
				this.popoverViewOnKiloLink(modelId),
				chatModelSelectorData.gatewayInfoCopy.viewOnKiloLinkText,
				{
					message: `Info popover for "${modelId}" should label its external link "${chatModelSelectorData.gatewayInfoCopy.viewOnKiloLinkText}"`,
				},
			);
		}
	}

	/**
	 * Confirms the popover's own direct children stack without visually
	 * overlapping — each section's top edge must sit at or below the
	 * previous section's bottom edge. `PopoverContent` lays its children out
	 * as a vertical flex column, so this holds for any combination of the
	 * optional header, primary-metric row, risk meter, facts grid, and
	 * "View on Kilo" link that a given model renders.
	 */
	async verifyModelInfoSectionsDoNotOverlap(modelId: string): Promise<void> {
		const sections = this.infoPopover(modelId).locator(":scope > *");
		const count = await getLocatorCount(sections);
		expect(count, `Info popover for "${modelId}" should render content`).toBeGreaterThan(0);
		let previousBottom: number | undefined;
		for (let index = 0; index < count; index += 1) {
			const box = await sections.nth(index).boundingBox();
			expect(
				box,
				`Info popover section ${index} for "${modelId}" should be rendered`,
			).not.toBeNull();
			if (previousBottom !== undefined) {
				expect(
					box!.y,
					`Info popover section ${index} for "${modelId}" should not overlap the section above it`,
				).toBeGreaterThanOrEqual(previousBottom - 1);
			}
			previousBottom = box!.y + box!.height;
		}
	}

	/**
	 * Switch the rail view, converging: the popover keeps re-rendering while the
	 * catalog settles, which remounts the rail buttons and drops a coordinate click
	 * mid-flight (Playwright reports "element is not stable" then "detached"). The
	 * rail button is a plain `click` target, so a DOM click is deterministic — the
	 * same workaround the mode selector uses for this composer's animated popups.
	 */
	private async selectRail(target: Locator): Promise<void> {
		await expect(async () => {
			if (!(await isElementVisible(this.menu()))) {
				await this.openModelSelector();
			}
			await clickByJS(target);
			await expectElementToHaveAttribute(target, "aria-pressed", "true", {
				message: "Selected provider rail should be active",
			});
		}).toPass({ timeout: chatModelSelectorData.railConvergeTimeoutMs });
	}

	/**
	 * The catalog is fetched once the composer settles; the trigger carries
	 * `aria-busy` until then, and the rail only renders after it resolves.
	 */
	private async waitForTriggerSettled(): Promise<void> {
		await getPage().waitForFunction(
			(triggerId) => {
				const trigger = document.querySelector(`[data-qa-id="${triggerId}"]`);
				return trigger !== null && !trigger.hasAttribute("aria-busy");
			},
			chatModelSelectorData.locators.triggerTestId,
			{ timeout: chatModelSelectorData.settleTimeoutMs },
		);
	}
}
