"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckIcon, StarIcon } from "lucide-react";
import { motion } from "motion/react";
import {
	useMemo,
	useRef,
	useState,
	type FC,
	type KeyboardEvent,
	type MouseEvent,
	type MutableRefObject,
	type PointerEvent,
	type ReactNode,
} from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { useChatModelSelection } from "../../model-selection/ChatModelSelectionContext.js";
import {
	modelRefToId,
	parseModelId,
	type KiloCatalogModel,
	type KiloProviderGroup,
} from "../../model-selection/model-catalog.js";
import { sortModelsWithFavoritesFirst } from "../../model-selection/model-favorites.js";
import { filterModelsBySearchQuery } from "../../model-selection/model-search.js";
import { ProviderIcon } from "../../model-selection/provider-icon.js";
import { useModelFavorites } from "../../model-selection/use-model-favorites.js";
import {
	ModelSelector,
	ModelSelectorContent,
	ModelSelectorEffort,
	ModelSelectorEmpty,
	ModelSelectorItem,
	ModelSelectorList,
	ModelSelectorRoot,
	ModelSelectorSearch,
	ModelSelectorTrigger,
	ModelSelectorValue,
	useModelSelectorContext,
} from "./model-selector.js";

type RailSelection = "favorites" | (string & {});

/** Approximate row height for name + description + padding; measureElement corrects drift. */
const MODEL_ROW_ESTIMATE_PX = 52;
const MODEL_LIST_OVERSCAN = 12;

function nextHighlightIndex(
	length: number,
	currentIndex: number,
	key: "ArrowDown" | "ArrowUp" | "Home" | "End",
): number {
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

/**
 * Composer model picker: assistant-ui ModelSelector compound API with a
 * t3code-style provider rail (favorites + providers) and searchable list.
 */
export const KiloModelSelector: FC = () => {
	const { model, setModel, effort, setEffort, catalog, isCatalogPending, isCatalogError } =
		useChatModelSelection();
	const { favoriteIds, toggleFavorite, hasFavorites } = useModelFavorites();
	const [railSelection, setRailSelection] = useState<RailSelection | undefined>(undefined);
	const [searchQuery, setSearchQuery] = useState("");
	const [highlightId, setHighlightId] = useState<string | undefined>(undefined);
	const scrollToHighlightedRef = useRef<(id: string) => void>(() => {});
	const visibleModelsRef = useRef<readonly KiloCatalogModel[]>([]);

	const providers = catalog?.providers ?? [];
	const models = catalog?.models ?? [];
	const isSearching = searchQuery.trim().length > 0;

	const activeRail: RailSelection | undefined = useMemo(() => {
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
	}, [hasFavorites, model, providers, railSelection]);

	const visibleModels = useMemo(() => {
		const scoped = (() => {
			if (isSearching) {
				return models;
			}
			if (activeRail === "favorites") {
				return models.filter((entry) => favoriteIds.has(entry.id));
			}
			if (!activeRail) {
				return sortModelsWithFavoritesFirst(models, favoriteIds);
			}
			return sortModelsWithFavoritesFirst(
				models.filter((entry) => entry.providerID === activeRail),
				favoriteIds,
			);
		})();
		return isSearching ? filterModelsBySearchQuery(scoped, searchQuery) : scoped;
	}, [activeRail, favoriteIds, isSearching, models, searchQuery]);

	visibleModelsRef.current = visibleModels;

	const selectedId = model ? modelRefToId(model) : undefined;
	const commandValue =
		highlightId && visibleModels.some((entry) => entry.id === highlightId)
			? highlightId
			: (visibleModels.find((entry) => entry.id === selectedId)?.id ?? visibleModels[0]?.id);

	// ModelSelectorValue reads `selectedModel.icon` for the trigger — attach an icon
	// only for the selected row so we don't rebuild JSX for the whole catalog.
	const modelsForSelector = useMemo(() => {
		if (!selectedId) {
			return models;
		}
		const selectedIndex = models.findIndex((entry) => entry.id === selectedId);
		if (selectedIndex < 0) {
			return models;
		}
		const selected = models[selectedIndex]!;
		const next = models.slice();
		next[selectedIndex] = {
			...selected,
			icon: (
				<ProviderIcon
					provider={selected.providerID}
					variant="color"
					size={14}
					fallbackLabel={selected.description ?? selected.providerID}
				/>
			),
		};
		return next;
	}, [models, selectedId]);

	const showSidebar = !isSearching && providers.length > 0;
	const disabled = isCatalogPending || isCatalogError || models.length === 0;

	return (
		<ModelSelectorRoot
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
			onOpenChange={(open) => {
				if (!open) {
					setSearchQuery("");
					setHighlightId(undefined);
				}
			}}
		>
			<ModelSelectorTrigger
				variant="ghost"
				size="sm"
				disabled={disabled}
				className="shrink-0"
				data-qa-id="kilo-model-selector-trigger"
				aria-label={isCatalogPending ? "Loading models" : "Select model"}
				aria-busy={isCatalogPending || undefined}
			>
				<ModelSelectorValue
					placeholder={
						isCatalogPending ? (
							<>
								<span className="flex min-w-0 items-center gap-2" aria-hidden>
									<Skeleton className="bg-muted-foreground/25 size-3.5 shrink-0 rounded-sm" />
									<Skeleton className="bg-muted-foreground/25 h-3 w-24" />
								</span>
								<span className="sr-only">Loading models…</span>
							</>
						) : (
							"Select model"
						)
					}
					showEffort
				/>
			</ModelSelectorTrigger>
			<ModelSelectorContent
				searchable
				shouldFilter={false}
				align="start"
				className="w-[min(100vw,22.5rem)] max-w-[90vw] p-0"
				data-qa-id="kilo-model-selector-content"
				{...(commandValue !== undefined ? { commandValue } : {})}
				onCommandValueChange={(next) => {
					setHighlightId(next);
					scrollToHighlightedRef.current(next);
				}}
				onCommandKeyDown={(event) => {
					if (
						event.key !== "ArrowDown" &&
						event.key !== "ArrowUp" &&
						event.key !== "Home" &&
						event.key !== "End"
					) {
						return;
					}
					const list = visibleModelsRef.current;
					if (list.length === 0) {
						return;
					}
					event.preventDefault();
					const currentIndex = commandValue
						? list.findIndex((entry) => entry.id === commandValue)
						: -1;
					const nextIndex = nextHighlightIndex(list.length, currentIndex, event.key);
					const next = list[nextIndex];
					if (!next) {
						return;
					}
					setHighlightId(next.id);
					scrollToHighlightedRef.current(next.id);
				}}
			>
				<div className="flex max-h-64 overflow-hidden">
					{showSidebar ? (
						<ProviderRail
							providers={providers}
							selectedRail={activeRail}
							showFavorites
							onSelectRail={setRailSelection}
						/>
					) : null}
					<div
						className={cn(
							"flex min-h-0 min-w-0 flex-1 flex-col bg-muted/40",
							showSidebar && "border-l border-border/70",
						)}
					>
						<div className="px-2 pt-2">
							<div className="border-border/70 focus-within:border-ring border-b pb-2 transition-colors">
								<div className="flex h-7 items-center [&_[data-slot=command-input-wrapper]]:h-7 [&_[data-slot=command-input-wrapper]]:gap-1.5 [&_[data-slot=command-input-wrapper]]:px-1 [&_[data-slot=command-input-wrapper]]:py-0">
									<ModelSelectorSearch
										placeholder="Search models..."
										value={searchQuery}
										onValueChange={(next) => {
											setSearchQuery(next);
											setHighlightId(undefined);
										}}
										className="h-full text-sm leading-none"
									/>
								</div>
							</div>
						</div>
						<VirtualizedCatalogList
							models={visibleModels}
							favoriteIds={favoriteIds}
							emptyLabel={
								activeRail === "favorites" && !isSearching
									? "No favorite models yet."
									: "No models found."
							}
							scrollToHighlightedRef={scrollToHighlightedRef}
							onToggleFavorite={(entry) => {
								toggleFavorite({
									providerID: entry.providerID,
									modelID: entry.modelID,
								});
							}}
						/>
					</div>
				</div>
				<ModelSelectorEffort data-qa-id="kilo-model-selector-effort" />
			</ModelSelectorContent>
		</ModelSelectorRoot>
	);
};

const VirtualizedCatalogList: FC<{
	models: readonly KiloCatalogModel[];
	favoriteIds: ReadonlySet<string>;
	emptyLabel: string;
	scrollToHighlightedRef: MutableRefObject<(id: string) => void>;
	onToggleFavorite: (model: KiloCatalogModel) => void;
}> = ({ models, favoriteIds, emptyLabel, scrollToHighlightedRef, onToggleFavorite }) => {
	const listRef = useRef<HTMLDivElement>(null);
	const modelsRef = useRef(models);
	modelsRef.current = models;

	const virtualizer = useVirtualizer({
		count: models.length,
		getScrollElement: () => listRef.current,
		estimateSize: () => MODEL_ROW_ESTIMATE_PX,
		overscan: MODEL_LIST_OVERSCAN,
		getItemKey: (index) => models[index]?.id ?? index,
	});

	// Keep highlight→scroll wiring current without an effect (ref update during render).
	scrollToHighlightedRef.current = (id) => {
		const index = modelsRef.current.findIndex((entry) => entry.id === id);
		if (index >= 0) {
			virtualizer.scrollToIndex(index, { align: "auto" });
		}
	};

	const virtualItems = virtualizer.getVirtualItems();

	return (
		<ModelSelectorList ref={listRef} className="scroll-fade max-h-52 px-1 py-1">
			{models.length === 0 ? <ModelSelectorEmpty>{emptyLabel}</ModelSelectorEmpty> : null}
			{models.length > 0 ? (
				<div
					className="relative w-full"
					style={{ height: virtualizer.getTotalSize() }}
					data-qa-id="kilo-model-selector-virtual-list"
				>
					{virtualItems.map((virtualRow) => {
						const entry = models[virtualRow.index];
						if (!entry) {
							return null;
						}
						return (
							<div
								key={entry.id}
								data-index={virtualRow.index}
								ref={virtualizer.measureElement}
								className="absolute top-0 left-0 w-full"
								style={{ transform: `translateY(${virtualRow.start}px)` }}
							>
								<motion.div
									layout="position"
									transition={{
										type: "spring",
										stiffness: 500,
										damping: 35,
										mass: 0.8,
									}}
								>
									<CatalogModelItem
										model={entry}
										isFavorite={favoriteIds.has(entry.id)}
										onToggleFavorite={() => {
											onToggleFavorite(entry);
										}}
									/>
								</motion.div>
							</div>
						);
					})}
				</div>
			) : null}
		</ModelSelectorList>
	);
};

const ProviderRail: FC<{
	providers: readonly KiloProviderGroup[];
	selectedRail: RailSelection | undefined;
	showFavorites: boolean;
	onSelectRail: (rail: RailSelection) => void;
}> = ({ providers, selectedRail, showFavorites, onSelectRail }) => {
	return (
		<TooltipProvider delay={0}>
			<div
				className="bg-muted/30 w-11 shrink-0 [scrollbar-width:none] overflow-y-auto overscroll-contain [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
				data-qa-id="kilo-model-selector-rail"
			>
				<div className="relative flex min-h-full flex-col gap-1 p-1">
					{showFavorites ? (
						<>
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
							<div className="border-border/70 border-b" aria-hidden />
						</>
					) : null}
					{providers.map((provider) => {
						const isSelected = provider.id === selectedRail;
						return (
							<RailButton
								key={provider.id}
								label={provider.connected ? provider.name : `${provider.name} — not connected`}
								selected={isSelected}
								disabled={!provider.connected}
								onSelect={() => {
									onSelectRail(provider.id);
								}}
								data-qa-id={`kilo-model-selector-rail-${provider.id}`}
							>
								<ProviderIcon
									provider={provider.id}
									variant={isSelected ? "color" : "mono"}
									size={20}
									fallbackLabel={provider.name}
									className="size-5"
								/>
							</RailButton>
						);
					})}
				</div>
			</div>
		</TooltipProvider>
	);
};

function isListNavigationKey(key: string): boolean {
	return key === "ArrowUp" || key === "ArrowDown" || key === "Home" || key === "End";
}

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
							"relative isolate flex aspect-square w-full cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none",
							selected && "bg-foreground/5 text-primary",
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

const CatalogModelItem: FC<{
	model: KiloCatalogModel;
	isFavorite: boolean;
	onToggleFavorite: () => void;
}> = ({ model, isFavorite, onToggleFavorite }) => {
	const { value } = useModelSelectorContext();
	const isSelected = value === model.id;

	return (
		<ModelSelectorItem
			model={model}
			showCheck={false}
			className="group/model-item rounded-md py-2"
			data-qa-id={`kilo-model-option-${model.id}`}
		>
			<span className="mt-0.5 shrink-0 [&_svg]:size-3.5">
				<ProviderIcon
					provider={model.providerID}
					variant="color"
					size={14}
					fallbackLabel={model.description ?? model.providerID}
				/>
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium">{model.name}</span>
				{model.description ? (
					<span className="text-muted-foreground truncate text-xs">{model.description}</span>
				) : null}
			</span>
			<span className="mt-0.5 flex shrink-0 items-center gap-0.5">
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								type="button"
								size="icon-xs"
								variant="ghost"
								className={cn(
									"text-muted-foreground/70 shrink-0 opacity-64 transition-[color,opacity] hover:text-foreground hover:opacity-100 group-hover/model-item:opacity-100",
									isFavorite && "text-foreground opacity-100",
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
								/>
							</Button>
						}
					/>
					<TooltipContent side="top">
						{isFavorite ? "Remove from favorites" : "Add to favorites"}
					</TooltipContent>
				</Tooltip>
				{isSelected ? (
					<span className="flex size-6 items-center justify-center">
						<CheckIcon className="size-3.5" />
					</span>
				) : null}
			</span>
		</ModelSelectorItem>
	);
};

// Re-export compound namespace for callers that want ModelSelector.*
export { ModelSelector };
