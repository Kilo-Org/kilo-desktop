"use client";

import { StarIcon } from "lucide-react";
import {
	useMemo,
	useState,
	type FC,
	type KeyboardEvent,
	type MouseEvent,
	type PointerEvent,
	type ReactNode,
} from "react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { useChatModelSelection } from "../../ChatModelSelectionContext.js";
import {
	modelRefToId,
	parseModelId,
	type KiloCatalogModel,
	type KiloProviderGroup,
} from "../../model-catalog.js";
import { sortModelsWithFavoritesFirst } from "../../model-favorites.js";
import { ProviderIcon } from "../../provider-icon.js";
import { useModelFavorites } from "../../use-model-favorites.js";
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
} from "./model-selector.js";

type RailSelection = "favorites" | (string & {});

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

	const providers = catalog?.providers ?? [];
	const models = catalog?.models ?? [];
	const isSearching = searchQuery.trim().length > 0;

	const modelsWithIcons = useMemo(
		() =>
			models.map((entry) => ({
				...entry,
				icon: (
					<ProviderIcon
						provider={entry.providerID}
						size={14}
						fallbackLabel={entry.description ?? entry.providerID}
					/>
				),
			})),
		[models],
	);

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
		if (isSearching) {
			return modelsWithIcons;
		}
		if (activeRail === "favorites") {
			return modelsWithIcons.filter((entry) => favoriteIds.has(entry.id));
		}
		if (!activeRail) {
			return sortModelsWithFavoritesFirst(modelsWithIcons, favoriteIds);
		}
		return sortModelsWithFavoritesFirst(
			modelsWithIcons.filter((entry) => entry.providerID === activeRail),
			favoriteIds,
		);
	}, [activeRail, favoriteIds, isSearching, modelsWithIcons]);

	const value = model ? modelRefToId(model) : undefined;
	const showSidebar = !isSearching && providers.length > 0;
	const disabled = isCatalogPending || isCatalogError || modelsWithIcons.length === 0;

	return (
		<ModelSelectorRoot
			models={modelsWithIcons}
			{...(value === undefined ? {} : { value })}
			{...(effort === undefined ? {} : { effort })}
			onValueChange={(next) => {
				const parsed = parseModelId(next);
				if (parsed) {
					setModel(parsed);
					setRailSelection(parsed.providerID);
				}
			}}
			onEffortChange={setEffort}
			onOpenChange={(open) => {
				if (!open) {
					setSearchQuery("");
				}
			}}
		>
			<ModelSelectorTrigger
				variant="ghost"
				size="sm"
				disabled={disabled}
				className="max-w-48 min-w-0 shrink"
				data-qa-id="kilo-model-selector-trigger"
				aria-label="Select model"
			>
				<ModelSelectorValue
					placeholder={isCatalogPending ? "Loading models…" : "Select model"}
					showEffort
				/>
			</ModelSelectorTrigger>
			<ModelSelectorContent
				searchable
				align="start"
				className="w-[min(100vw,22.5rem)] max-w-[90vw] p-0"
				data-qa-id="kilo-model-selector-content"
			>
				<div className="flex max-h-86 overflow-hidden">
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
										onValueChange={setSearchQuery}
										className="h-full text-sm leading-none"
									/>
								</div>
							</div>
						</div>
						<ModelSelectorList className="max-h-72 px-1 py-1">
							<ModelSelectorEmpty>
								{activeRail === "favorites" && !isSearching
									? "No favorite models yet."
									: "No models found."}
							</ModelSelectorEmpty>
							{visibleModels.map((entry) => (
								<CatalogModelItem
									key={entry.id}
									model={entry}
									isFavorite={favoriteIds.has(entry.id)}
									onToggleFavorite={() => {
										toggleFavorite({
											providerID: entry.providerID,
											modelID: entry.modelID,
										});
									}}
								/>
							))}
						</ModelSelectorList>
					</div>
				</div>
				<ModelSelectorEffort data-qa-id="kilo-model-selector-effort" />
			</ModelSelectorContent>
		</ModelSelectorRoot>
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
	return (
		<ModelSelectorItem
			model={model}
			className="group/model-item rounded-md py-2 pe-10"
			data-qa-id={`kilo-model-option-${model.id}`}
		>
			{model.icon ? <span className="mt-0.5 shrink-0 [&_svg]:size-3.5">{model.icon}</span> : null}
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="truncate font-medium">{model.name}</span>
				{model.description ? (
					<span className="text-muted-foreground truncate text-xs">{model.description}</span>
				) : null}
			</span>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							type="button"
							size="icon-xs"
							variant="ghost"
							className={cn(
								"text-muted-foreground/70 absolute end-8 top-2 shrink-0 opacity-64 transition-[color,opacity] hover:text-foreground hover:opacity-100 group-hover/model-item:opacity-100",
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
							<StarIcon className={cn("size-3.5", isFavorite && "fill-current text-yellow-500")} />
						</Button>
					}
				/>
				<TooltipContent side="top">
					{isFavorite ? "Remove from favorites" : "Add to favorites"}
				</TooltipContent>
			</Tooltip>
		</ModelSelectorItem>
	);
};

// Re-export compound namespace for callers that want ModelSelector.*
export { ModelSelector };
