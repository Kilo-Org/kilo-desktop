"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ArrowRightIcon,
	BookOpenCheckIcon,
	CheckIcon,
	ChevronDownIcon,
	ChevronUpIcon,
	InfoIcon,
	ListFilterIcon,
	PlusIcon,
	SettingsIcon,
	StarIcon,
	ServerIcon,
} from "lucide-react";
import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type FC,
	type KeyboardEvent,
	type MouseEvent,
	type MutableRefObject,
	type PointerEvent,
	type ReactNode,
	type RefObject,
} from "react";

import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button, buttonVariants } from "@kilo-desktop/ui/components/button";
import { ExternalLink } from "@kilo-desktop/ui/components/external-link";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@kilo-desktop/ui/components/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { CommandItem } from "@kilo-desktop/ui/components/command";
import { cn } from "@kilo-desktop/ui/lib/utils";
import { KernelOs } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";

import type {
	ComposerActionPopoverProps,
	ComposerActionStateProps,
	ComposerActionTrigger,
} from "../../contracts";
import { KILO_PROVIDER_ID } from "./provider-ids";
import { useChatModelSelection } from "./ChatModelSelectionContext";
import {
	isKiloGatewayProvider,
	modelRefToId,
	parseModelId,
	type KiloCatalogModel,
	type KiloModelRef,
	type KiloProviderGroup,
} from "./model-catalog";
import { sortModelsWithFavoritesFirst } from "./model-favorites";
import { filterModelsBySearchQuery } from "./model-search";
import { ProviderIcon } from "@kilo-desktop/ui/components/provider-icon";
import { useKiloSignIn } from "./use-kilo-sign-in";
import { useModelFavorites } from "./use-model-favorites";
import { effortsForOptimisticTrigger } from "./model-selection-utils";
import type { ModelCostTier } from "./model-cost";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEffort,
	ModelSelectorEmpty,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorRoot,
	ModelSelectorSearch,
	ModelSelectorValue,
	useModelSelectorContext,
	type ModelSelectorEffortOption,
} from "./model-selector";

type RailSelection = "favorites" | (string & {});

const SIGN_IN_ITEM_ID = "kilo-sign-in";

/** Approximate row heights (title, optional cost line, padding); measureElement corrects drift. */
const MODEL_ROW_ESTIMATE_PX = 28;
const MODEL_ROW_WITH_COST_ESTIMATE_PX = 46;
const MODEL_LIST_OVERSCAN = 12;
const KILO_MODEL_PAGE_BASE_URL = "https://kilo.ai/models/";
const MODEL_SELECTOR_COLLISION_AVOIDANCE = {
	side: "flip",
	align: "shift",
	fallbackAxisSide: "none",
} as const;

/** cmdk scrolls the highlighted option into view; that fights wheel/trackpad scrolling. */
function suppressCmdkScrollIntoView(node: HTMLElement | null) {
	if (node) {
		node.scrollIntoView = () => {};
	}
}

type ScrollEdges = { top: boolean; bottom: boolean };

/**
 * Tracks whether a scroll viewport has hidden content above/below, to drive
 * scroll arrows (the fade itself is the CSS `scroll-fade-y` utility).
 */
function useScrollEdges(viewportRef: RefObject<HTMLElement | null>) {
	const [edges, setEdges] = useState<ScrollEdges>({ top: false, bottom: false });
	const update = () => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const top = viewport.scrollTop > 1;
		const bottom = viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;
		setEdges((current) =>
			current.top === top && current.bottom === bottom ? current : { top, bottom },
		);
	};

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) return;
		const observer = new ResizeObserver(update);
		observer.observe(viewport);
		if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
		update();
		return () => observer.disconnect();
	}, [update, viewportRef]);

	return { edges, update };
}

function toggledSet<T>(current: ReadonlySet<T>, value: T, checked: boolean): Set<T> {
	const next = new Set(current);
	if (checked) next.add(value);
	else next.delete(value);
	return next;
}

type ListNavigationKey = "ArrowDown" | "ArrowUp" | "Home" | "End";

function isListNavigationKey(key: string): key is ListNavigationKey {
	return key === "ArrowUp" || key === "ArrowDown" || key === "Home" || key === "End";
}

type CatalogModelSection = {
	id: "auto" | "recommended" | "kilo";
	label: "Auto models" | "Recommended" | "Kilo Gateway";
	models: readonly KiloCatalogModel[];
};

type CatalogListEntry =
	| { kind: "section"; id: string; label: string }
	| { kind: "model"; model: KiloCatalogModel };

function isKiloAutoModel(model: KiloCatalogModel): boolean {
	return (
		model.providerID === KILO_PROVIDER_ID &&
		(model.modelID.startsWith("kilo-auto/") ||
			model.modelID === "auto-small" ||
			model.name.startsWith("Auto ") ||
			model.name === "Organization Auto")
	);
}

function gatewayPublisherId(model: KiloCatalogModel): string | undefined {
	if (model.providerID !== KILO_PROVIDER_ID || isKiloAutoModel(model)) return undefined;
	// "~vendor/..." ids are floating "latest" aliases from the same publisher as "vendor/...".
	const modelID = model.modelID.replace(/^~/, "");
	const separator = modelID.indexOf("/");
	return separator > 0 ? modelID.slice(0, separator) : "other";
}

function gatewayPublisherLabel(model: KiloCatalogModel, id: string): string {
	if (id === "other") return "Other";
	const separator = model.name.indexOf(": ");
	if (separator > 0) return model.name.slice(0, separator);
	if (id === "openai") return "OpenAI";
	if (id === "xai") return "xAI";
	return id
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

function kiloGatewayModelSections(models: readonly KiloCatalogModel[]): CatalogModelSection[] {
	const auto: KiloCatalogModel[] = [];
	const recommended: KiloCatalogModel[] = [];
	const remaining: KiloCatalogModel[] = [];

	for (const model of models) {
		if (isKiloAutoModel(model)) {
			auto.push(model);
		} else if (model.recommendedIndex !== undefined) {
			recommended.push(model);
		} else {
			remaining.push(model);
		}
	}

	const byRecommendation = (left: KiloCatalogModel, right: KiloCatalogModel) =>
		(left.recommendedIndex ?? Number.POSITIVE_INFINITY) -
			(right.recommendedIndex ?? Number.POSITIVE_INFINITY) || left.name.localeCompare(right.name);
	auto.sort(byRecommendation);
	recommended.sort(byRecommendation);
	remaining.sort((left, right) => left.name.localeCompare(right.name));

	return [
		...(auto.length > 0 ? [{ id: "auto", label: "Auto models", models: auto } as const] : []),
		...(recommended.length > 0
			? [{ id: "recommended", label: "Recommended", models: recommended } as const]
			: []),
		...(remaining.length > 0
			? [{ id: "kilo", label: "Kilo Gateway", models: remaining } as const]
			: []),
	];
}

function showsCostIndicator(
	model: KiloCatalogModel,
): model is KiloCatalogModel & { costTier: ModelCostTier } {
	return model.providerID === KILO_PROVIDER_ID && !!model.costTier && !isKiloAutoModel(model);
}

const COST_INDICATORS = {
	low: { tooltip: "Cost: Low", dollars: "$" },
	medium: { tooltip: "Cost: Medium", dollars: "$$" },
	high: { tooltip: "Cost: High", dollars: "$$$" },
	"very-high": { tooltip: "Cost: Very High", dollars: "$$$+" },
} as const satisfies Record<ModelCostTier, { tooltip: string; dollars: string }>;

type GatewayCostFilter = ModelCostTier | "free" | "auto";
const GATEWAY_COST_OPTIONS: readonly { id: GatewayCostFilter; label: string }[] = [
	{ id: "free", label: "Free" },
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Medium" },
	{ id: "high", label: "High" },
	{ id: "very-high", label: "Very high" },
	{ id: "auto", label: "Auto" },
];

function withProviderIcon(model: KiloCatalogModel): KiloCatalogModel {
	return {
		...model,
		icon: (
			<ProviderIcon
				provider={model.providerID}
				variant="color"
				size={14}
				fallbackLabel={model.providerName ?? model.providerID}
			/>
		),
	};
}

/** Trigger-only row from localStorage while `provider.list` is still in flight. */
function optimisticTriggerModel(
	ref: KiloModelRef,
	meta: {
		name: string | undefined;
		effort: string | undefined;
		efforts: readonly ModelSelectorEffortOption[] | undefined;
	},
): KiloCatalogModel {
	const efforts = effortsForOptimisticTrigger(meta.effort, meta.efforts);
	return {
		id: modelRefToId(ref),
		name: meta.name ?? ref.modelID,
		providerID: ref.providerID,
		modelID: ref.modelID,
		...(efforts ? { efforts } : {}),
	};
}

const NO_PROVIDERS: readonly KiloProviderGroup[] = [];
const NO_MODELS: readonly KiloCatalogModel[] = [];

/** The catalog's providers, with the local model source's slotted in before the first non-Kilo one. */
function withSourceProvider(
	catalogProviders: readonly KiloProviderGroup[],
	sourceProviderId: string | undefined,
	sourceTitle: string | undefined,
): readonly KiloProviderGroup[] {
	if (
		!sourceProviderId ||
		!sourceTitle ||
		catalogProviders.some((provider) => provider.id === sourceProviderId)
	) {
		return catalogProviders;
	}
	const localProvider: KiloProviderGroup = {
		id: sourceProviderId,
		name: sourceTitle,
		connected: false,
	};
	const firstNonKilo = catalogProviders.findIndex((provider) => !isKiloGatewayProvider(provider));
	if (firstNonKilo < 0) return [...catalogProviders, localProvider];
	return [
		...catalogProviders.slice(0, firstNonKilo),
		localProvider,
		...catalogProviders.slice(firstNonKilo),
	];
}

/** The rail shown: the person's pick while it exists, else favorites, the model's provider, or the first. */
function resolveActiveRail(
	providers: readonly KiloProviderGroup[],
	railSelection: RailSelection | undefined,
	hasFavorites: boolean,
	model: KiloModelRef | undefined,
): RailSelection | undefined {
	if (railSelection === "favorites") {
		return "favorites";
	}
	if (railSelection && providers.some((provider) => provider.id === railSelection)) {
		return railSelection;
	}
	if (hasFavorites) {
		return "favorites";
	}
	if (model && providers.some((provider) => provider.id === model.providerID)) {
		return model.providerID;
	}
	return providers[0]?.id;
}

function gatewayPublisherOptions(
	models: readonly KiloCatalogModel[],
): readonly { id: string; label: string }[] {
	const options = new Map<string, string>();
	for (const entry of models) {
		const id = gatewayPublisherId(entry);
		if (id && !options.has(id)) options.set(id, gatewayPublisherLabel(entry, id));
	}
	return [...options]
		.map(([id, label]) => ({ id, label }))
		.sort((a, b) => a.label.localeCompare(b.label));
}

/** The selected publishers the catalog still has. */
function selectedPublisherIds(
	publishers: readonly { id: string }[],
	selected: ReadonlySet<string>,
): ReadonlySet<string> {
	return new Set(publishers.map(({ id }) => id).filter((id) => selected.has(id)));
}

function filterVisibleModels(
	models: readonly KiloCatalogModel[],
	view: {
		readonly activeRail: RailSelection | undefined;
		readonly activePublishers: ReadonlySet<string>;
		readonly favoriteIds: ReadonlySet<string>;
		readonly hasGatewayFilters: boolean;
		readonly kiloRailSelected: boolean;
		readonly searchQuery: string;
		readonly selectedCosts: ReadonlySet<GatewayCostFilter>;
	},
): readonly KiloCatalogModel[] {
	const { activeRail, activePublishers, favoriteIds, selectedCosts } = view;
	if (view.searchQuery.trim().length > 0)
		return filterModelsBySearchQuery(models, view.searchQuery);
	const scoped =
		activeRail === "favorites"
			? models.filter((entry) => favoriteIds.has(entry.id))
			: !activeRail
				? sortModelsWithFavoritesFirst(models, favoriteIds)
				: sortModelsWithFavoritesFirst(
						models.filter((entry) => entry.providerID === activeRail),
						favoriteIds,
					);
	if (!view.kiloRailSelected || !view.hasGatewayFilters) return scoped;
	return scoped.filter((entry) => {
		// Free is orthogonal to tier/auto: Auto Free matches both "free" and "auto".
		const matchesCost =
			selectedCosts.size === 0 ||
			(selectedCosts.has("free") && isFreeCatalogModel(entry)) ||
			(isKiloAutoModel(entry)
				? selectedCosts.has("auto")
				: entry.costTier !== undefined && selectedCosts.has(entry.costTier));
		const publisher = gatewayPublisherId(entry);
		return (
			matchesCost &&
			(activePublishers.size === 0 || (publisher !== undefined && activePublishers.has(publisher)))
		);
	});
}

/**
 * The catalog for the selector root, which reads `selectedModel.icon` for the
 * trigger: an icon only on the selected row, so the whole catalog's JSX is not
 * rebuilt; an optimistic row for the remembered model while the catalog loads.
 */
function selectorModels(
	models: readonly KiloCatalogModel[],
	selectedId: string | undefined,
	trigger: {
		readonly pendingModel: KiloModelRef | undefined;
		readonly name: string | undefined;
		readonly effort: string | undefined;
		readonly efforts: readonly ModelSelectorEffortOption[] | undefined;
	},
): readonly KiloCatalogModel[] {
	const { pendingModel, ...meta } = trigger;
	if (models.length === 0 && pendingModel) {
		return [withProviderIcon(optimisticTriggerModel(pendingModel, meta))];
	}
	if (!selectedId) {
		return models;
	}
	const selectedIndex = models.findIndex((entry) => entry.id === selectedId);
	if (selectedIndex < 0) {
		return models;
	}
	const next = models.slice();
	next[selectedIndex] = withProviderIcon(models[selectedIndex]!);
	return next;
}

function shouldMoveListWithHomeEnd(target: EventTarget | null, key: "Home" | "End"): boolean {
	if (!(target instanceof HTMLInputElement) && !(target instanceof HTMLTextAreaElement)) {
		return true;
	}
	const caretStart = target.selectionStart ?? 0;
	const caretEnd = target.selectionEnd ?? 0;
	if (key === "Home") {
		return caretStart === 0 && caretEnd === 0;
	}
	return caretStart === target.value.length && caretEnd === target.value.length;
}

function nextHighlightIndex(length: number, currentIndex: number, key: ListNavigationKey): number {
	if (length <= 0) {
		return -1;
	}
	switch (key) {
		case "Home":
			return 0;
		case "End":
			return length - 1;
		case "ArrowDown":
			if (currentIndex < 0) {
				return 0;
			}
			return Math.min(currentIndex + 1, length - 1);
		case "ArrowUp":
			if (currentIndex < 0) {
				return 0;
			}
			return Math.max(currentIndex - 1, 0);
		default: {
			const _exhaustive: never = key;
			return _exhaustive;
		}
	}
}

function selectedTriggerModel(models: readonly KiloCatalogModel[], selectedId: string | undefined) {
	const entry = selectedId ? models.find((candidate) => candidate.id === selectedId) : undefined;
	return entry ? [withProviderIcon(entry)] : [];
}

/** The model picker's button: the selected model, its provider's icon and effort. */
export function KiloModelTrigger({ children }: ComposerActionStateProps<ComposerActionTrigger>) {
	const {
		model,
		name,
		effort,
		efforts,
		catalog,
		isCatalogPending,
		isSelectionPending = false,
		isCatalogError,
		modelSource,
	} = useChatModelSelection();
	const models = catalog?.models ?? [];
	const selectedId = model ? modelRefToId(model) : undefined;
	const triggerModels =
		models.length === 0 && isCatalogPending && model
			? [withProviderIcon(optimisticTriggerModel(model, { name, effort, efforts }))]
			: selectedTriggerModel(models, selectedId);
	const hasProviders = (catalog?.providers.length ?? 0) > 0 || modelSource !== undefined;
	const showLoadingPlaceholder = (isCatalogPending || isSelectionPending) && !model;
	return children({
		label: (
			<ModelSelectorRoot
				embedded
				models={triggerModels}
				{...(selectedId === undefined ? {} : { value: selectedId })}
				{...(effort === undefined ? {} : { effort })}
			>
				<ModelSelectorValue
					placeholder={
						showLoadingPlaceholder ? (
							<>
								<span className="flex min-w-0 items-center gap-1.5" aria-hidden>
									<Skeleton className="size-3.5 shrink-0 rounded-sm" />
									<Skeleton className="h-3 w-24" />
								</span>
								<span className="sr-only">Loading models…</span>
							</>
						) : (
							"Select model"
						)
					}
					showEffort
				/>
			</ModelSelectorRoot>
		),
		ariaLabel: showLoadingPlaceholder ? "Loading models" : "Select model",
		busy: isCatalogPending,
		disabled: isCatalogError || (!isCatalogPending && models.length === 0 && !hasProviders),
	});
}

/** The model picker's popup, inside the composer action's popover. */
/**
 * What the picker lists for the person's rail, search and gateway filters:
 * the providers rail, the models (in sections on Kilo's rail), the local
 * model source's states, and the catalog the selector root reads.
 */
function useCatalogView(
	selection: ReturnType<typeof useChatModelSelection>,
	view: {
		readonly railSelection: RailSelection | undefined;
		readonly searchQuery: string;
		readonly selectedCosts: ReadonlySet<GatewayCostFilter>;
		readonly selectedPublishers: ReadonlySet<string>;
		readonly isStartingLocalProvider: boolean;
		readonly localServerStarting: boolean;
		readonly needsSignIn: boolean;
	},
) {
	const { favoriteIds, toggleFavorite, hasFavorites } = useModelFavorites();
	const {
		model,
		name,
		effort,
		efforts,
		catalog,
		isCatalogPending,
		isCatalogFetching = false,
		modelSource,
	} = selection;
	const { searchQuery, selectedCosts } = view;
	const sourceProviderId = modelSource?.providerId;
	const providers = withSourceProvider(
		catalog?.providers ?? NO_PROVIDERS,
		sourceProviderId,
		modelSource?.title,
	);
	const activeRail = resolveActiveRail(providers, view.railSelection, hasFavorites, model);
	const kiloRailSelected = providers.some(
		(provider) => provider.id === activeRail && isKiloGatewayProvider(provider),
	);
	const models = catalog?.models ?? NO_MODELS;
	const isSearching = searchQuery.trim().length > 0;
	const gatewayPublishers = gatewayPublisherOptions(models);
	const activePublishers = selectedPublisherIds(gatewayPublishers, view.selectedPublishers);
	const hasGatewayFilters = selectedCosts.size > 0 || activePublishers.size > 0;
	const visibleModels = filterVisibleModels(models, {
		activeRail,
		activePublishers,
		favoriteIds,
		hasGatewayFilters,
		kiloRailSelected,
		searchQuery,
		selectedCosts,
	});
	const modelSections =
		kiloRailSelected && !isSearching && !hasGatewayFilters
			? kiloGatewayModelSections(visibleModels)
			: undefined;
	const displayedModels = modelSections?.flatMap((section) => section.models) ?? visibleModels;
	const showSignInItem = view.needsSignIn && !isCatalogPending && !isSearching && kiloRailSelected;
	const sourceRailSelected = sourceProviderId !== undefined && activeRail === sourceProviderId;
	const catalogHasLocalModels = models.some((entry) => entry.providerID === sourceProviderId);
	const awaitingLocalCatalog =
		sourceRailSelected &&
		!catalogHasLocalModels &&
		(modelSource?.pending === true || (modelSource?.hasModels === true && isCatalogFetching));
	const showLocalModelLoading =
		(!catalogHasLocalModels &&
			(view.isStartingLocalProvider || (sourceRailSelected && view.localServerStarting))) ||
		awaitingLocalCatalog;
	const selectedId = model ? modelRefToId(model) : undefined;
	return {
		favoriteIds,
		toggleFavorite,
		providers,
		activeRail,
		kiloRailSelected,
		isSearching,
		gatewayPublishers,
		activePublishers,
		hasGatewayFilters,
		modelSections,
		displayedModels,
		showModelProviderIcons: isSearching || activeRail === "favorites" || activeRail === undefined,
		showSignInItem,
		showLocalModelLoading,
		showLocalModelEmptyState:
			!isCatalogPending &&
			!showLocalModelLoading &&
			!isSearching &&
			sourceRailSelected &&
			!catalogHasLocalModels,
		showLocalModelActions:
			!isCatalogPending && !showLocalModelLoading && !isSearching && sourceRailSelected,
		navIds: showSignInItem
			? [SIGN_IN_ITEM_ID, ...displayedModels.map((entry) => entry.id)]
			: displayedModels.map((entry) => entry.id),
		selectedId,
		// ModelSelectorValue reads `selectedModel.icon` for the trigger — attach an icon
		// only for the selected row so we don't rebuild JSX for the whole catalog.
		modelsForSelector: selectorModels(models, selectedId, {
			pendingModel: isCatalogPending ? model : undefined,
			name,
			effort,
			efforts,
		}),
		showSidebar: isCatalogPending || (!isSearching && providers.length > 0),
	};
}

export const KiloModelSelectorContent: FC<Pick<ComposerActionPopoverProps, "open" | "close">> = ({
	open,
	close,
}) => {
	const navigation = useDomainObject(Navigation);
	const { needsSignIn, signIn } = useKiloSignIn();
	const selection = useChatModelSelection();
	const { setModel, effort, setEffort, refreshCatalog, modelSource } = selection;
	const isCatalogPending = selection.isCatalogPending;
	// Providers added or removed in AI Providers (kilo.core) since the catalog
	// was read show up when the picker opens.
	useEffect(() => {
		if (open) refreshCatalog?.();
	}, [open, refreshCatalog]);
	const sourceProviderId = modelSource?.providerId;
	const sourceStatus = modelSource?.status;
	const startSource = modelSource?.start;
	const [railSelection, setRailSelection] = useState<RailSelection | undefined>(undefined);
	const [isStartingLocalProvider, setIsStartingLocalProvider] = useState(false);
	const isStartingLocalProviderRef = useRef(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedCosts, setSelectedCosts] = useState<ReadonlySet<GatewayCostFilter>>(
		() => new Set(),
	);
	const [selectedPublishers, setSelectedPublishers] = useState<ReadonlySet<string>>(
		() => new Set(),
	);
	const [highlightId, setHighlightId] = useState<string | undefined>(undefined);
	const scrollToHighlightedRef = useRef<(id: string) => void>(() => {});
	const isListScrollingRef = useRef(false);
	const [wasOpen, setWasOpen] = useState(open);
	if (open !== wasOpen) {
		setWasOpen(open);
		if (!open) {
			setSearchQuery("");
			setHighlightId(undefined);
		}
	}
	const localServerRunning =
		sourceStatus?.status === "ready" || sourceStatus?.status === "loading-model";
	const localServerStarting =
		sourceStatus?.status === "preparing-runtime" || sourceStatus?.status === "starting";
	const {
		favoriteIds,
		toggleFavorite,
		providers,
		activeRail,
		kiloRailSelected,
		isSearching,
		gatewayPublishers,
		activePublishers,
		hasGatewayFilters,
		modelSections,
		displayedModels,
		showModelProviderIcons,
		showSignInItem,
		showLocalModelLoading,
		showLocalModelEmptyState,
		showLocalModelActions,
		navIds,
		selectedId,
		modelsForSelector,
		showSidebar,
	} = useCatalogView(selection, {
		railSelection,
		searchQuery,
		selectedCosts,
		selectedPublishers,
		isStartingLocalProvider,
		localServerStarting,
		needsSignIn,
	});

	const selectRail = (nextRail: RailSelection) => {
		setRailSelection(nextRail);
		if (
			nextRail !== sourceProviderId ||
			localServerRunning ||
			localServerStarting ||
			!startSource ||
			isStartingLocalProviderRef.current
		) {
			return;
		}

		isStartingLocalProviderRef.current = true;
		setIsStartingLocalProvider(true);
		void startSource()
			.catch(() => undefined)
			.finally(() => {
				isStartingLocalProviderRef.current = false;
				setIsStartingLocalProvider(false);
			});
	};
	const clearGatewayFilters = () => {
		setSelectedCosts(new Set());
		setSelectedPublishers(new Set());
		setHighlightId(undefined);
	};
	const sourceSettingsSection = modelSource?.settingsSection;
	const openLocalModelServerSettings = () =>
		void navigation?.methods
			.openSettings({ ...(sourceSettingsSection ? { section: sourceSettingsSection } : {}) })
			.catch(() => undefined);
	const commandValue =
		highlightId && navIds.includes(highlightId)
			? highlightId
			: (displayedModels.find((entry) => entry.id === selectedId)?.id ?? navIds[0]);

	return (
		<ModelSelectorRoot
			embedded
			open={open}
			onOpenChange={(next) => {
				if (!next) close();
			}}
			models={modelsForSelector}
			{...(selectedId === undefined ? {} : { value: selectedId })}
			{...(effort === undefined ? {} : { effort })}
			onValueChange={(next) => {
				const parsed = parseModelId(next);
				if (parsed) {
					setModel(parsed);
					setRailSelection(parsed.providerID);
					setHighlightId(next);
				}
			}}
			onEffortChange={setEffort}
		>
			<ModelSelectorContent
				searchable
				shouldFilter={false}
				align="start"
				side="bottom"
				collisionAvoidance={MODEL_SELECTOR_COLLISION_AVOIDANCE}
				className="ring-foreground/15 w-[min(100vw,26rem)] max-w-[min(100vw,26rem)] min-w-0 p-0"
				data-qa-id="kilo-model-selector-content"
				{...(commandValue !== undefined ? { commandValue } : {})}
				onCommandValueChange={(next) => {
					if (isListScrollingRef.current) {
						return;
					}
					setHighlightId(next);
				}}
				onCommandKeyDown={(event) => {
					if (!isListNavigationKey(event.key)) {
						return;
					}
					if (
						(event.key === "Home" || event.key === "End") &&
						!shouldMoveListWithHomeEnd(event.target, event.key)
					) {
						return;
					}
					const list = navIds;
					if (list.length === 0) {
						return;
					}
					event.preventDefault();
					const currentIndex = commandValue ? list.indexOf(commandValue) : -1;
					const nextIndex = nextHighlightIndex(list.length, currentIndex, event.key);
					const next = list[nextIndex];
					if (!next) {
						return;
					}
					setHighlightId(next);
					scrollToHighlightedRef.current(next);
				}}
			>
				<div
					className="flex h-72 max-h-[calc(100dvh-2rem)] w-full min-w-0 overflow-hidden"
					{...(isCatalogPending || showLocalModelLoading
						? {
								"data-qa-id": "kilo-model-selector-loading",
								"aria-busy": true as const,
								"aria-label": "Loading models",
							}
						: {})}
				>
					{isCatalogPending ? <ProviderRailSkeleton /> : null}
					{!isCatalogPending && showSidebar ? (
						<ProviderRail
							providers={providers}
							selectedRail={activeRail}
							onSelectRail={selectRail}
							sourceProviderId={sourceProviderId}
						/>
					) : null}
					<div className="flex min-h-0 min-w-0 flex-1 flex-col">
						<div className="px-2 pt-2">
							<div className="border-b pb-2">
								<div className="flex h-7 items-center gap-1 [&_[data-slot=command-input-wrapper]]:m-0 [&_[data-slot=command-input-wrapper]]:h-7 [&_[data-slot=command-input-wrapper]]:min-w-0 [&_[data-slot=command-input-wrapper]]:flex-1 [&_[data-slot=command-input-wrapper]]:gap-1.5 [&_[data-slot=command-input-wrapper]]:border-0 [&_[data-slot=command-input-wrapper]]:px-1 [&_[data-slot=command-input-wrapper]]:py-0">
									<ModelSelectorSearch
										placeholder="Search models"
										value={searchQuery}
										onValueChange={(next) => {
											setSearchQuery(next);
											setHighlightId(undefined);
										}}
										disabled={isCatalogPending || showLocalModelLoading}
										className="h-full text-sm leading-none"
									/>
									{showLocalModelActions ? (
										<LocalModelServerSettingsButton onClick={openLocalModelServerSettings} />
									) : null}
									{!isCatalogPending && !isSearching && kiloRailSelected ? (
										<GatewayModelFilter
											selectedCosts={selectedCosts}
											publishers={gatewayPublishers}
											selectedPublishers={activePublishers}
											onCostCheckedChange={(cost, checked) => {
												setSelectedCosts((current) => toggledSet(current, cost, checked));
												setHighlightId(undefined);
											}}
											onPublisherCheckedChange={(publisher, checked) => {
												setSelectedPublishers((current) => toggledSet(current, publisher, checked));
												setHighlightId(undefined);
											}}
											onClear={clearGatewayFilters}
										/>
									) : null}
								</div>
							</div>
						</div>
						{isCatalogPending || showLocalModelLoading ? (
							<>
								<span className="sr-only">Loading models…</span>
								<ModelListSkeleton />
							</>
						) : (
							<VirtualizedCatalogList
								models={displayedModels}
								currentModelId={selectedId}
								{...(modelSections ? { sections: modelSections } : {})}
								favoriteIds={favoriteIds}
								showProviderIcons={showModelProviderIcons}
								showSignInItem={showSignInItem}
								onSignIn={signIn}
								emptyContent={
									showLocalModelEmptyState ? (
										<LocalModelServerEmptyState onAddModel={openLocalModelServerSettings} />
									) : activeRail === "favorites" && !isSearching ? (
										"No favorite models yet."
									) : kiloRailSelected && !isSearching && hasGatewayFilters ? (
										<div className="flex flex-col items-center gap-2">
											<span>No models match these filters.</span>
											<Button
												type="button"
												variant="ghost"
												size="xs"
												data-qa-id="kilo-model-filter-clear-empty"
												onClick={clearGatewayFilters}
											>
												Clear filters
											</Button>
										</div>
									) : (
										"No models found."
									)
								}
								scrollToHighlightedRef={scrollToHighlightedRef}
								isListScrollingRef={isListScrollingRef}
								onToggleFavorite={(entry) => {
									toggleFavorite({
										providerID: entry.providerID,
										modelID: entry.modelID,
									});
								}}
							/>
						)}
					</div>
				</div>
				{isCatalogPending || showLocalModelLoading ? null : (
					<ModelSelectorEffort data-qa-id="kilo-model-selector-effort" />
				)}
			</ModelSelectorContent>
		</ModelSelectorRoot>
	);
};

const GatewayModelFilter: FC<{
	selectedCosts: ReadonlySet<GatewayCostFilter>;
	publishers: readonly { id: string; label: string }[];
	selectedPublishers: ReadonlySet<string>;
	onCostCheckedChange: (cost: GatewayCostFilter, checked: boolean) => void;
	onPublisherCheckedChange: (publisher: string, checked: boolean) => void;
	onClear: () => void;
}> = ({
	selectedCosts,
	publishers,
	selectedPublishers,
	onCostCheckedChange,
	onPublisherCheckedChange,
	onClear,
}) => {
	const activeCount = selectedCosts.size + selectedPublishers.size;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="data-active:text-primary-soft-foreground data-active:hover:text-primary-soft-foreground data-active:data-open:text-primary-soft-foreground"
						data-active={activeCount > 0 || undefined}
						aria-label={activeCount ? `Filter models, ${activeCount} active` : "Filter models"}
						data-qa-id="kilo-model-filter-trigger"
						onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => event.stopPropagation()}
					/>
				}
			>
				<ListFilterIcon className="size-3.5" aria-hidden="true" />
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align="end"
				side="bottom"
				className="max-h-72"
				data-qa-id="kilo-model-filter-content"
				onKeyDown={(event) => event.stopPropagation()}
			>
				<DropdownMenuGroup>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger className="w-full" data-qa-id="kilo-model-filter-cost-trigger">
							<span className="flex min-w-0 flex-1 items-center">
								Cost
								{selectedCosts.size > 0 ? (
									<span className="text-muted-foreground ml-auto">{selectedCosts.size}</span>
								) : null}
							</span>
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent onKeyDown={(event) => event.stopPropagation()}>
							<DropdownMenuGroup>
								{GATEWAY_COST_OPTIONS.map(({ id, label }) => (
									<DropdownMenuCheckboxItem
										key={id}
										checked={selectedCosts.has(id)}
										closeOnClick={false}
										data-qa-id={`kilo-model-filter-cost-${id}`}
										onCheckedChange={(checked) => onCostCheckedChange(id, checked === true)}
									>
										{label}
									</DropdownMenuCheckboxItem>
								))}
							</DropdownMenuGroup>
						</DropdownMenuSubContent>
					</DropdownMenuSub>
					{publishers.length > 0 ? (
						<DropdownMenuSub>
							<DropdownMenuSubTrigger
								className="w-full"
								data-qa-id="kilo-model-filter-publisher-trigger"
							>
								<span className="flex min-w-0 flex-1 items-center">
									Publisher
									{selectedPublishers.size > 0 ? (
										<span className="text-muted-foreground ml-auto">{selectedPublishers.size}</span>
									) : null}
								</span>
							</DropdownMenuSubTrigger>
							<DropdownMenuSubContent
								className={cn(
									"max-h-72 overflow-y-auto",
									publishers.length > 10 && "overflow-y-scroll",
								)}
								data-qa-id="kilo-model-filter-publisher-content"
								onKeyDown={(event) => event.stopPropagation()}
							>
								<DropdownMenuGroup className="p-1">
									{publishers.map(({ id, label }) => (
										<DropdownMenuCheckboxItem
											key={id}
											checked={selectedPublishers.has(id)}
											closeOnClick={false}
											data-qa-id={`kilo-model-filter-publisher-${id}`}
											onCheckedChange={(checked) => onPublisherCheckedChange(id, checked === true)}
										>
											{label}
										</DropdownMenuCheckboxItem>
									))}
								</DropdownMenuGroup>
							</DropdownMenuSubContent>
						</DropdownMenuSub>
					) : null}
				</DropdownMenuGroup>
				{activeCount > 0 ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuGroup>
							<DropdownMenuItem data-qa-id="kilo-model-filter-clear" onClick={onClear}>
								Clear all
							</DropdownMenuItem>
						</DropdownMenuGroup>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

function GatewaySignInItem({ onSignIn }: { onSignIn: () => void }) {
	const { setOpen } = useModelSelectorContext();

	return (
		<CommandItem
			ref={suppressCmdkScrollIntoView}
			value={SIGN_IN_ITEM_ID}
			keywords={["connect", "login", "kilo"]}
			data-qa-id="kilo-model-selector-signin"
			onSelect={() => {
				setOpen(false);
				onSignIn();
			}}
			className="group/model-item items-start gap-2 rounded-md py-1 ps-1.5 pe-1.5 [&>svg:last-child]:hidden"
		>
			<span className="flex h-5 shrink-0 items-center [&_svg]:size-3.5">
				<ProviderIcon provider="kilo" variant="color" size={14} fallbackLabel="Kilo" />
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium">Connect to Kilo</span>
				<span className="text-muted-foreground truncate text-xs">Use your models and credits</span>
			</span>
			<span className="mt-0.5 flex size-6 shrink-0 items-center justify-center">
				<ArrowRightIcon className="text-muted-foreground size-3.5" />
			</span>
		</CommandItem>
	);
}

const MODEL_CATALOG_SKELETON_ROWS = 5;
const MODEL_CATALOG_SKELETON_RAIL_SLOTS = 4;
const MODEL_LIST_SKELETON_NAME_WIDTHS = ["7.5rem", "9rem", "6.5rem", "8.25rem", "7rem"] as const;
const MODEL_LIST_SKELETON_DESC_WIDTHS = [
	"5.5rem",
	"6.25rem",
	"4.75rem",
	"5.75rem",
	"5rem",
] as const;

const ProviderRailSkeleton: FC = () => {
	return (
		<div className="bg-background/40 w-11 shrink-0" aria-hidden>
			<div className="relative flex min-h-full flex-col gap-1 p-1">
				<div className="bg-foreground/5 flex aspect-square w-full items-center justify-center rounded-md">
					<Skeleton className="size-5 rounded-sm" />
				</div>
				<div className="border-b" />
				{Array.from({ length: MODEL_CATALOG_SKELETON_RAIL_SLOTS }, (_, index) => (
					<div
						key={index}
						className="flex aspect-square w-full items-center justify-center rounded-md"
					>
						<Skeleton className="size-5 rounded-sm" />
					</div>
				))}
			</div>
		</div>
	);
};

const ModelListSkeleton: FC = () => {
	return (
		<div className="scroll-fade max-h-52 space-y-0.5 overflow-hidden px-1 py-1" aria-hidden>
			{Array.from({ length: MODEL_CATALOG_SKELETON_ROWS }, (_, index) => (
				<div key={index} className="flex items-start gap-2 rounded-md px-2 py-2">
					<span className="flex h-5 shrink-0 items-center">
						<Skeleton className="size-3.5 rounded-sm" />
					</span>
					<span className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton className="h-3.5" style={{ width: MODEL_LIST_SKELETON_NAME_WIDTHS[index] }} />
						<Skeleton className="h-3" style={{ width: MODEL_LIST_SKELETON_DESC_WIDTHS[index] }} />
					</span>
					<Skeleton className="mt-0.5 size-3.5 shrink-0 rounded-sm" />
				</div>
			))}
		</div>
	);
};

interface CatalogListProps {
	models: readonly KiloCatalogModel[];
	currentModelId: string | undefined;
	favoriteIds: ReadonlySet<string>;
	showProviderIcons: boolean;
	showSignInItem: boolean;
	onSignIn: () => void;
	emptyContent: ReactNode;
	scrollToHighlightedRef: MutableRefObject<(id: string) => void>;
	isListScrollingRef: MutableRefObject<boolean>;
	onToggleFavorite: (model: KiloCatalogModel) => void;
}

function catalogListEntries(
	models: readonly KiloCatalogModel[],
	sections: readonly CatalogModelSection[] | undefined,
): readonly CatalogListEntry[] {
	return sections
		? sections.flatMap((section): CatalogListEntry[] => [
				{ kind: "section", id: section.id, label: section.label },
				...section.models.map((model) => ({ kind: "model" as const, model })),
			])
		: models.map((model) => ({ kind: "model", model }));
}

/** The catalog's rows, with section headings when it has sections. */
const VirtualizedCatalogList: FC<
	CatalogListProps & { sections?: readonly CatalogModelSection[] | undefined }
> = ({ sections, ...props }) => (
	<VirtualizedCatalogRows {...props} listEntries={catalogListEntries(props.models, sections)} />
);

const VirtualizedCatalogRows: FC<
	CatalogListProps & { listEntries: readonly CatalogListEntry[] }
> = ({
	models,
	listEntries,
	currentModelId,
	favoriteIds,
	showProviderIcons,
	showSignInItem,
	onSignIn,
	emptyContent,
	scrollToHighlightedRef,
	isListScrollingRef,
	onToggleFavorite,
}) => {
	"use no memo";
	// TanStack's useVirtualizer mutates one instance in place, so memoizing its readers would show stale rows.
	const listRef = useRef<HTMLDivElement>(null);
	// This component opts out of React Compiler with "use no memo" above.
	// react-doctor-disable-next-line react-hooks-js/incompatible-library
	const virtualizer = useVirtualizer({
		count: listEntries.length,
		getScrollElement: () => listRef.current,
		estimateSize: (index) => {
			const entry = listEntries[index];
			if (entry?.kind === "section") return index === 0 ? 24 : 28;
			return entry && showsCostIndicator(entry.model)
				? MODEL_ROW_WITH_COST_ESTIMATE_PX
				: MODEL_ROW_ESTIMATE_PX;
		},
		overscan: MODEL_LIST_OVERSCAN,
		getItemKey: (index) => {
			const entry = listEntries[index];
			if (!entry) return index;
			return entry.kind === "section" ? `section:${entry.id}` : entry.model.id;
		},
		onChange: (instance) => {
			isListScrollingRef.current = instance.isScrolling;
		},
	});

	// Only keyboard handlers call this, after commit, so the committed rows are the ones to scroll.
	useLayoutEffect(() => {
		scrollToHighlightedRef.current = (id) => {
			if (id === SIGN_IN_ITEM_ID) {
				listRef.current?.scrollTo({ top: 0 });
				return;
			}
			const index = listEntries.findIndex(
				(entry) => entry.kind === "model" && entry.model.id === id,
			);
			if (index >= 0) {
				virtualizer.scrollToIndex(index, { align: "auto" });
			}
		};
	});

	const virtualItems = virtualizer.getVirtualItems();

	return (
		<ModelSelectorList
			ref={listRef}
			showScrollbar
			className={cn(
				"scroll-fade-y min-h-0 flex-1 px-1 py-1",
				models.length === 0 && "[&_[cmdk-list-sizer]]:h-full",
			)}
			data-qa-id="kilo-model-selector-list"
			onScroll={() => {
				isListScrollingRef.current = true;
			}}
		>
			{showSignInItem ? <GatewaySignInItem onSignIn={onSignIn} /> : null}
			{models.length === 0 ? (
				<ModelSelectorEmpty className="flex h-full items-center justify-center p-0">
					{emptyContent}
				</ModelSelectorEmpty>
			) : null}
			{models.length > 0 ? (
				<div
					className="relative w-full"
					style={{ height: virtualizer.getTotalSize() }}
					data-qa-id="kilo-model-selector-virtual-list"
				>
					{virtualItems.map((virtualRow) => {
						const entry = listEntries[virtualRow.index];
						if (!entry) {
							return null;
						}
						if (entry.kind === "section") {
							return (
								<div
									key={`section:${entry.id}`}
									data-index={virtualRow.index}
									ref={virtualizer.measureElement}
									className="absolute top-0 left-0 w-full"
									style={{ transform: `translateY(${virtualRow.start}px)` }}
								>
									<h3
										className={cn(
											// Same inset and type as CommandGroup headings, so labels line up with items.
											"text-muted-foreground px-1.5 pb-1 text-xs font-medium",
											virtualRow.index === 0 ? "pt-1" : "pt-2",
										)}
										data-qa-id={`kilo-model-section-${entry.id}`}
									>
										{entry.label}
									</h3>
								</div>
							);
						}
						const model = entry.model;
						return (
							<div
								key={model.id}
								data-index={virtualRow.index}
								ref={virtualizer.measureElement}
								className="absolute top-0 left-0 w-full"
								style={{ transform: `translateY(${virtualRow.start}px)` }}
							>
								<CatalogModelItem
									model={model}
									isCurrent={model.id === currentModelId}
									isFavorite={favoriteIds.has(model.id)}
									showProviderIcon={showProviderIcons}
									tooltipsDisabled={virtualizer.isScrolling}
									onToggleFavorite={() => {
										onToggleFavorite(model);
									}}
								/>
							</div>
						);
					})}
				</div>
			) : null}
		</ModelSelectorList>
	);
};

const LocalModelServerEmptyState: FC<{ onAddModel: () => void }> = ({ onAddModel }) => {
	return (
		<Empty>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<ServerIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>Run AI on your device</EmptyTitle>
				<EmptyDescription>
					Private local inference that keeps your prompts, outputs, and data under your control.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button type="button" size="sm" onClick={onAddModel}>
					<PlusIcon data-icon="inline-start" aria-hidden="true" />
					Add a local model
				</Button>
			</EmptyContent>
		</Empty>
	);
};

const LocalModelServerSettingsButton: FC<{ onClick: () => void }> = ({ onClick }) => {
	const label = "Server settings";
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="sm"
						aria-label={label}
						data-qa-id="kilo-local-model-settings"
						className="px-2"
						onClick={onClick}
						onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
							event.stopPropagation();
						}}
					/>
				}
			>
				<SettingsIcon className="size-3.5" aria-hidden="true" />
			</TooltipTrigger>
			<TooltipContent side="bottom">{label}</TooltipContent>
		</Tooltip>
	);
};

const ProviderRail: FC<{
	providers: readonly KiloProviderGroup[];
	selectedRail: RailSelection | undefined;
	onSelectRail: (rail: RailSelection) => void;
	/** A model source's provider: selectable before Kilo connects it. */
	sourceProviderId?: string | undefined;
}> = ({ providers, selectedRail, onSelectRail, sourceProviderId }) => {
	const scrollRef = useRef<HTMLDivElement>(null);
	const { edges: scrollHints, update: updateScrollHints } = useScrollEdges(scrollRef);
	const scrollProviders = (direction: -1 | 1) => {
		const viewport = scrollRef.current;
		if (!viewport) return;
		viewport.scrollBy({
			top: direction * Math.max(viewport.clientHeight - 40, 40),
			behavior: "smooth",
		});
	};

	return (
		<div className="bg-background/40 relative w-11 shrink-0 overflow-hidden">
			<div
				ref={scrollRef}
				className="no-scrollbar scroll-fade-y h-full overflow-y-auto overscroll-contain"
				data-qa-id="kilo-model-selector-rail"
				onScroll={updateScrollHints}
			>
				<div className="relative flex min-h-full flex-col gap-1 p-1">
					<RailButton
						label="Favorites"
						selected={selectedRail === "favorites"}
						onSelect={() => {
							onSelectRail("favorites");
						}}
						data-qa-id="kilo-model-selector-rail-favorites"
					>
						<StarIcon className="size-5 shrink-0 fill-current" aria-hidden />
					</RailButton>
					<div className="border-b" aria-hidden />
					{providers.map((provider) => {
						const isSelected = provider.id === selectedRail;
						const isLocalProvider = provider.id === sourceProviderId;
						const isSelectable = provider.connected || isLocalProvider;
						const label = provider.name;
						return (
							<RailButton
								key={provider.id}
								label={isSelectable ? label : `${label} — not connected`}
								selected={isSelected}
								disabled={!isSelectable}
								onSelect={() => {
									onSelectRail(provider.id);
								}}
								data-qa-id={`kilo-model-selector-rail-${provider.id}`}
							>
								<ProviderIcon
									provider={provider.id}
									variant={isSelected ? "color" : "mono"}
									size={20}
									fallbackLabel={label}
									className="size-5"
								/>
							</RailButton>
						);
					})}
				</div>
			</div>
			{scrollHints.top ? (
				<div
					className="absolute inset-x-0 top-0 z-10 h-6"
					data-qa-id="kilo-model-selector-rail-more-above"
				>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						// Same edge strip as the chat tab strip's scroll arrows, filled with
						// the rail's own surface (background/40 over the popover).
						className="size-full rounded-none border-0 bg-[color-mix(in_oklab,var(--background)_40%,var(--popover))] hover:bg-[color-mix(in_oklab,var(--background)_40%,var(--popover))] active:not-aria-[haspopup]:translate-y-0"
						aria-label="Scroll providers up"
						onClick={() => scrollProviders(-1)}
						onKeyDown={(event) => event.stopPropagation()}
					>
						<ChevronUpIcon className="size-4" aria-hidden="true" />
					</Button>
				</div>
			) : null}
			{scrollHints.bottom ? (
				<div
					className="absolute inset-x-0 bottom-0 z-10 h-6"
					data-qa-id="kilo-model-selector-rail-more-below"
				>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						// Same edge strip as the chat tab strip's scroll arrows, filled with
						// the rail's own surface (background/40 over the popover).
						className="size-full rounded-none border-0 bg-[color-mix(in_oklab,var(--background)_40%,var(--popover))] hover:bg-[color-mix(in_oklab,var(--background)_40%,var(--popover))] active:not-aria-[haspopup]:translate-y-0"
						aria-label="Scroll providers down"
						onClick={() => scrollProviders(1)}
						onKeyDown={(event) => event.stopPropagation()}
					>
						<ChevronDownIcon className="size-4" aria-hidden="true" />
					</Button>
				</div>
			) : null}
		</div>
	);
};

const RailButton: FC<{
	label: string;
	selected: boolean;
	disabled?: boolean;
	onSelect: () => void;
	children: ReactNode;
	"data-qa-id"?: string;
}> = ({ label, selected, disabled = false, onSelect, children, "data-qa-id": qaId }) => {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<button
						type="button"
						aria-label={label}
						aria-pressed={selected}
						disabled={disabled}
						data-qa-id={qaId}
						className={cn(
							"relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none",
							selected && "bg-muted text-primary-soft-foreground",
							disabled && "cursor-not-allowed opacity-50 hover:bg-transparent",
						)}
						onClick={() => {
							if (!disabled) {
								onSelect();
							}
						}}
						onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
							// Let ↑/↓ bubble to cmdk so the model list stays keyboard-navigable
							// when focus is on the rail. Block other keys (Enter) so they don't
							// also select the highlighted model.
							if (isListNavigationKey(event.key)) {
								return;
							}
							event.stopPropagation();
						}}
					>
						{children}
					</button>
				}
			/>
			<TooltipContent side="left" sideOffset={8}>
				{label}
			</TooltipContent>
		</Tooltip>
	);
};

const MODEL_BADGE_CLASS = "h-4.5 px-1.5 text-[10px] font-semibold tracking-wide uppercase";

function isFreeCatalogModel(model: KiloCatalogModel): boolean {
	return model.isFree === true || model.details?.isFree === true;
}

/** Mirrors the Kilo extension: BYOK supersedes Free (the user's key is billed). */
function showsFreeLabel(model: KiloCatalogModel): boolean {
	return isFreeCatalogModel(model) && model.hasByok !== true;
}

/** Rows with a second line (cost or Free) top-align the provider icon. */
function hasSecondaryLine(model: KiloCatalogModel): boolean {
	return showsCostIndicator(model) || showsFreeLabel(model);
}

/**
 * BYOK badge and data-training marker next to the model name; the marker
 * follows the free flag independently of BYOK.
 */
const ModelNameBadges: FC<{ model: KiloCatalogModel; disabled: boolean }> = ({
	model,
	disabled,
}) => {
	const isFree = isFreeCatalogModel(model);
	const hasByok = model.hasByok === true;
	if (!isFree && !hasByok) return null;
	return (
		<span
			className="inline-flex shrink-0 items-center gap-1"
			data-qa-id={`kilo-model-badges-${model.id}`}
		>
			{hasByok ? (
				<Badge
					variant="soft"
					className={MODEL_BADGE_CLASS}
					data-qa-id={`kilo-model-byok-badge-${model.id}`}
				>
					BYOK
				</Badge>
			) : null}
			{isFree ? (
				<Tooltip disabled={disabled}>
					<TooltipTrigger
						render={
							<span
								className="text-muted-foreground inline-flex items-center"
								aria-label="Data may be used for training."
								data-qa-id={`kilo-model-data-training-${model.id}`}
							>
								<BookOpenCheckIcon className="size-3.5" aria-hidden="true" />
							</span>
						}
					/>
					<TooltipContent side="top">Data may be used for training.</TooltipContent>
				</Tooltip>
			) : null}
		</span>
	);
};

const CatalogModelItem: FC<{
	model: KiloCatalogModel;
	isCurrent: boolean;
	isFavorite: boolean;
	showProviderIcon: boolean;
	tooltipsDisabled: boolean;
	onToggleFavorite: () => void;
}> = ({ model, isCurrent, isFavorite, showProviderIcon, tooltipsDisabled, onToggleFavorite }) => {
	return (
		<ModelSelectorItem
			model={model}
			showCheck={false}
			className="group/model-item"
			data-current={isCurrent || undefined}
			data-auto-free={isFreeCatalogModel(model) ? "1" : undefined}
			data-qa-id={`kilo-model-option-${model.id}`}
			ref={suppressCmdkScrollIntoView}
		>
			{showProviderIcon ? (
				<span
					className={cn(
						"flex h-5 shrink-0 items-center [&_svg]:size-3.5",
						// Two-line rows: keep the icon on the name line, not the centre.
						hasSecondaryLine(model) && "self-start",
					)}
					data-qa-id={`kilo-model-option-provider-${model.id}`}
				>
					<ProviderIcon
						provider={model.providerID}
						variant="color"
						size={14}
						fallbackLabel={model.providerName ?? model.providerID}
					/>
				</span>
			) : null}
			<span className="flex min-w-0 flex-1 flex-col gap-0.5 pr-3">
				<span className="flex min-w-0 items-center gap-1.5">
					<span className="min-w-0 truncate text-sm leading-5 font-normal">{model.name}</span>
					<ModelNameBadges model={model} disabled={tooltipsDisabled} />
					{isCurrent ? (
						<span className="text-primary-ink inline-flex shrink-0 items-center">
							<CheckIcon className="size-3.5" aria-hidden="true" />
							<span className="sr-only">Current model</span>
						</span>
					) : null}
				</span>
				{showsFreeLabel(model) ? (
					<span
						className="text-primary-ink self-start text-xs leading-4 font-medium"
						data-qa-id={`kilo-model-free-label-${model.id}`}
					>
						Free
					</span>
				) : showsCostIndicator(model) ? (
					<ModelCostIndicator
						tier={model.costTier}
						modelId={model.id}
						disabled={tooltipsDisabled}
					/>
				) : null}
			</span>
			<span className="flex shrink-0 items-center gap-1">
				{model.providerID === KILO_PROVIDER_ID ? <ModelInfoPopover model={model} /> : null}
				<Tooltip disabled={tooltipsDisabled}>
					<TooltipTrigger
						render={
							<Button
								type="button"
								size="icon-xs"
								variant="ghost"
								className={cn(
									"shrink-0 opacity-64 transition-opacity hover:opacity-100 group-hover/model-item:opacity-100",
									isFavorite && "opacity-100",
								)}
								aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
								data-qa-id={`kilo-model-favorite-${model.id}`}
								onClick={(event: MouseEvent<HTMLButtonElement>) => {
									event.preventDefault();
									event.stopPropagation();
									onToggleFavorite();
								}}
								onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
									if (isListNavigationKey(event.key)) {
										return;
									}
									event.stopPropagation();
								}}
								onPointerDown={(event: PointerEvent<HTMLButtonElement>) => {
									event.stopPropagation();
								}}
							>
								<StarIcon
									className={cn("size-3.5", isFavorite && "fill-current text-yellow-500")}
									aria-hidden="true"
								/>
							</Button>
						}
					/>
					<TooltipContent side="top">
						{isFavorite ? "Remove from favorites" : "Add to favorites"}
					</TooltipContent>
				</Tooltip>
			</span>
		</ModelSelectorItem>
	);
};

/** Shows sub-cent amounts with an extra digit so they are not mistaken for free. */
function formatDollars(value: number): string {
	return `$${value.toFixed(value > 0 && value < 0.01 ? 3 : 2)}`;
}

function formatPrice(value: number): string {
	return `${formatDollars(value)}/1M`;
}

function formatTokenLimit(value: number): string {
	return new Intl.NumberFormat("en-US", {
		notation: "compact",
		maximumFractionDigits: value >= 1_000_000 ? 2 : 0,
	}).format(value);
}

function primaryModelMetric(model: KiloCatalogModel): { label: string; value: string } | undefined {
	const details = model.details;
	if (details?.kiloBenchScore !== undefined) {
		return {
			label: "Kilo Bench completion",
			value: `${(details.kiloBenchScore * 100).toFixed(1)}%`,
		};
	}
	if (details?.codingIndex !== undefined) {
		return { label: "Coding index", value: details.codingIndex.toFixed(1) };
	}
	if (details?.codeModeRank !== undefined) {
		return { label: "Code mode rank", value: `#${details.codeModeRank}` };
	}
	return undefined;
}

const EnkryptRiskIndicator: FC<{ value: number }> = ({ value }) => {
	const display = value.toFixed(1);
	const marker = value < 100 / 3 ? "bg-success" : value < 200 / 3 ? "bg-warning" : "bg-destructive";
	return (
		// A native <meter> renders only its own gauge and hides children, so it can't show the score text.
		// react-doctor-disable-next-line react-doctor/prefer-tag-over-role
		<div
			role="meter"
			aria-label="Enkrypt risk score"
			aria-valuemin={0}
			aria-valuemax={100}
			aria-valuenow={value}
			aria-valuetext={`${display} out of 100. Lower is safer.`}
			className="flex shrink-0 items-center gap-2"
		>
			<span className={cn("size-2 shrink-0 rounded-full", marker)} aria-hidden="true" />
			<span className="whitespace-nowrap tabular-nums">
				<span className="text-sm font-medium">{display}</span>
				<span className="text-muted-foreground text-xs"> / 100</span>
			</span>
		</div>
	);
};

const ModelInfoPopover: FC<{ model: KiloCatalogModel }> = ({ model }) => {
	const os = useDomainObject(KernelOs);
	const [open, setOpen] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!open) return;
		const list = triggerRef.current?.closest('[data-qa-id="kilo-model-selector-list"]');
		if (!list) return;
		const closeOnScroll = () => setOpen(false);
		list.addEventListener("scroll", closeOnScroll, { passive: true });
		return () => list.removeEventListener("scroll", closeOnScroll);
	}, [open]);
	const details = model.details;
	const primaryMetric = primaryModelMetric(model);
	const publisher = gatewayPublisherId(model);
	const logoProvider = publisher && publisher !== "other" ? publisher : model.providerID;
	const modelPageUrl = details?.modelPageSlug
		? `${KILO_MODEL_PAGE_BASE_URL}${details.modelPageSlug}`
		: undefined;
	const facts = details
		? [
				details.inputPricePerMillion !== undefined
					? { label: "Input", value: formatPrice(details.inputPricePerMillion) }
					: undefined,
				details.outputPricePerMillion !== undefined
					? { label: "Output", value: formatPrice(details.outputPricePerMillion) }
					: undefined,
				details.averageAttemptCostUsd !== undefined
					? { label: "Avg. attempt", value: formatDollars(details.averageAttemptCostUsd) }
					: undefined,
				details.contextWindow !== undefined
					? { label: "Context", value: `${formatTokenLimit(details.contextWindow)} tokens` }
					: undefined,
				details.maxOutputTokens !== undefined
					? { label: "Max output", value: `${formatTokenLimit(details.maxOutputTokens)} tokens` }
					: undefined,
				model.hasByok === true
					? { label: "Billing", value: "BYOK" }
					: details.isFree === true
						? { label: "Billing", value: "Free" }
						: undefined,
				details.mayTrainOnYourPrompts !== undefined
					? { label: "Prompt training", value: details.mayTrainOnYourPrompts ? "May" : "No" }
					: undefined,
			].filter((fact): fact is { label: string; value: string } => fact !== undefined)
		: [];

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<PopoverTrigger
				render={
					<Button
						ref={triggerRef}
						type="button"
						size="icon-xs"
						variant="ghost"
						aria-label={`Information about ${model.name}`}
						data-qa-id={`kilo-model-info-${model.id}`}
						onClick={(event: MouseEvent<HTMLButtonElement>) => event.stopPropagation()}
						onPointerDown={(event: PointerEvent<HTMLButtonElement>) => event.stopPropagation()}
						onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
							if (!isListNavigationKey(event.key)) event.stopPropagation();
						}}
					>
						<InfoIcon className="size-3.5" aria-hidden="true" />
					</Button>
				}
			/>
			<PopoverContent
				side="right"
				align="center"
				collisionAvoidance={MODEL_SELECTOR_COLLISION_AVOIDANCE}
				className="max-h-[calc(100dvh-2rem)] w-80 gap-3.5 overflow-y-auto p-3"
				data-qa-id={`kilo-model-info-popover-${model.id}`}
			>
				<PopoverHeader className="gap-2">
					<div className="flex items-center gap-2">
						<span
							className="inline-flex shrink-0"
							data-qa-id={`kilo-model-info-logo-${model.id}`}
							data-provider={logoProvider}
						>
							<ProviderIcon
								provider={logoProvider}
								variant="color"
								size={14}
								fallback={<ProviderIcon provider="kilo" variant="color" size={14} />}
							/>
						</span>
						<PopoverTitle className="min-w-0 truncate text-sm">{model.name}</PopoverTitle>
					</div>
					<PopoverDescription className="text-xs leading-normal">
						{details?.description ?? model.description ?? "Model details are unavailable."}
					</PopoverDescription>
				</PopoverHeader>

				{primaryMetric ? (
					<div className="flex items-center justify-between gap-3 text-xs">
						<span className="text-muted-foreground text-xs">{primaryMetric.label}</span>
						<span className="text-sm font-medium tabular-nums">{primaryMetric.value}</span>
					</div>
				) : !details ? (
					<p className="text-muted-foreground text-xs">Detailed metrics are unavailable.</p>
				) : null}

				{details?.enkryptRiskScore !== undefined ? (
					<div className="flex items-center justify-between gap-3">
						<div className="flex flex-col gap-0">
							<span className="text-muted-foreground text-xs">Enkrypt risk score</span>
							<span className="text-muted-foreground text-2xs leading-3">Lower is safer</span>
						</div>
						<EnkryptRiskIndicator value={details.enkryptRiskScore} />
					</div>
				) : null}

				{facts.length > 0 ? (
					<dl className="grid grid-cols-2 gap-x-5 gap-y-3">
						{facts.map((fact) => (
							<div key={fact.label} className="flex min-w-0 flex-col gap-0.5">
								<dt className="text-muted-foreground text-2xs">{fact.label}</dt>
								<dd className="text-xs font-medium tabular-nums">{fact.value}</dd>
							</div>
						))}
					</dl>
				) : null}

				{modelPageUrl ? (
					<ExternalLink
						href={modelPageUrl}
						onOpen={(url) => void os?.methods.openExternal({ url }).catch(() => undefined)}
						className={buttonVariants({ variant: "ghost", size: "xs", className: "ml-auto" })}
					>
						View on Kilo <ArrowRightIcon data-icon="inline-end" />
					</ExternalLink>
				) : null}
			</PopoverContent>
		</Popover>
	);
};

const ModelCostIndicator: FC<{ tier: ModelCostTier; modelId: string; disabled: boolean }> = ({
	tier,
	modelId,
	disabled,
}) => {
	const indicator = COST_INDICATORS[tier];
	return (
		<Tooltip disabled={disabled}>
			<TooltipTrigger
				render={
					<span
						className="text-muted-foreground inline-flex items-center self-start text-xs leading-4 font-normal"
						aria-label={indicator.tooltip}
						data-qa-id={`kilo-model-cost-${modelId}`}
					>
						{indicator.dollars}
					</span>
				}
			/>
			<TooltipContent side="top">{indicator.tooltip}</TooltipContent>
		</Tooltip>
	);
};

// Re-export compound namespace for callers that want ModelSelector.*
export { ModelSelector };
