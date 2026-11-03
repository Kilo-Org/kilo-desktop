import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
	BinaryIcon,
	EyeIcon,
	ListFilterIcon,
	MessageCircleIcon,
	SearchIcon,
	WrenchIcon,
	type LucideIcon,
} from "lucide-react";

import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@kilo-desktop/ui/components/input-group";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { TableCell, TableRow } from "@kilo-desktop/ui/components/table";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type {
	LocalInferenceHardwareProfile,
	ModelCatalogCapabilities,
	ModelCatalogEntry,
} from "../../contracts/schemas.js";
import { hasRecommendationQuantization } from "../../shared/catalog/model-compatibility.js";
import { sortCatalogModels, type CatalogSort } from "../../shared/catalog/model-recommendations.js";
import {
	ModelCatalogEmpty,
	ModelCatalogError,
	ModelCatalogLoading,
	ModelCatalogNoResults,
	ModelCatalogSignIn,
} from "./CatalogStates.js";
import { catalogTableCellClassNames, ModelCatalogTableFrame } from "./ModelCatalogTableLayout.js";
import { ModelIdentity } from "./ModelIdentity.js";
import { ModelPerformance } from "./ModelPerformance.js";
import { ModelRecommendations } from "./ModelRecommendations.js";
import { getPublisherDisplayName } from "./ModelPublisherIcon.js";
import { catalogListQueryOptions } from "./catalog-query.js";
import { localInferenceQueryOptions, useLocalInference } from "../local-inference.js";
import { useCatalogAnacondaAccount } from "./use-anaconda-account.js";

const defaultCatalogSort: CatalogSort = "newest";

const catalogSortOptions = [
	{ label: "Newest", value: "newest" },
	{ label: "Estimated performance", value: "best-fit" },
	{ label: "Fastest", value: "fastest" },
	{ label: "Largest", value: "parameters-desc" },
	{ label: "Smallest", value: "parameters-asc" },
] as const satisfies ReadonlyArray<{ label: string; value: CatalogSort }>;

const modelCapabilityIndicators = [
	{ id: "chat", label: "Chat", icon: MessageCircleIcon },
	{ id: "toolCalling", label: "Tool calling", icon: WrenchIcon },
	{ id: "vision", label: "Vision", icon: EyeIcon },
	{ id: "embedding", label: "Embedding", icon: BinaryIcon },
] as const satisfies ReadonlyArray<{
	id: keyof ModelCatalogCapabilities;
	label: string;
	icon: LucideIcon;
}>;

export function LocalModelCatalog({
	onSelectModel,
	selectedModelId,
}: {
	onSelectModel: (model: ModelCatalogEntry) => void;
	selectedModelId?: string | undefined;
}) {
	const client = useLocalInference();
	const [search, setSearch] = useState("");
	const deferredSearch = useDeferredValue(search);
	const anaconda = useCatalogAnacondaAccount();
	const catalog = useQuery(catalogListQueryOptions(client, anaconda));
	const hardware = useQuery({
		...localInferenceQueryOptions(client, "hardwareProfile"),
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	// Only a definite "no usable key" (anonymous) prompts sign-in; an `error`
	// session (e.g. offline whoami) or a missing anaconda-account plugin falls
	// through to the generic retry state.
	const needsAnacondaSignIn =
		catalog.isError &&
		anaconda.available &&
		!anaconda.resolving &&
		anaconda.session.status === "anonymous";
	const signInToAnaconda = async (): Promise<void> => {
		const result = await anaconda.signIn();
		if (!result.ok && !result.cancelled) {
			toast.error("Could not sign in to Anaconda", { description: result.reason });
		}
	};
	// Sign-in, error and empty replace the whole catalog and center in the pane.
	const showsFullPaneState =
		!catalog.isPending &&
		!hardware.isPending &&
		(needsAnacondaSignIn || catalog.isError || catalog.data.models.length === 0);
	const filteredModels = useMemo(
		() => filterCatalogModels(catalog.data?.models ?? [], deferredSearch),
		[catalog.data?.models, deferredSearch],
	);

	return (
		<div
			className={cn("@container min-w-0", showsFullPaneState && "flex flex-1 flex-col")}
			data-qa-id="local-model-catalog"
		>
			{catalog.isPending || hardware.isPending ? (
				<ModelCatalogLoading />
			) : needsAnacondaSignIn ? (
				<ModelCatalogSignIn
					signingIn={anaconda.signingIn}
					onSignIn={() => void signInToAnaconda()}
					onCancel={() => void anaconda.cancelSignIn()}
				/>
			) : catalog.isError ? (
				<ModelCatalogError message={catalog.error.message} onRetry={() => void catalog.refetch()} />
			) : catalog.data.models.length === 0 ? (
				<ModelCatalogEmpty />
			) : (
				<>
					{hardware.data ? (
						<ModelRecommendations
							models={catalog.data.models}
							hardware={hardware.data}
							onSelectModel={onSelectModel}
							selectedModelId={selectedModelId}
						/>
					) : null}
					<ModelCatalogTable
						models={filteredModels}
						hardware={hardware.data}
						search={search}
						onSearchChange={setSearch}
						onSelectModel={onSelectModel}
						selectedModelId={selectedModelId}
					/>
				</>
			)}
		</div>
	);
}

function filterCatalogModels(models: ModelCatalogEntry[], search: string): ModelCatalogEntry[] {
	const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (terms.length === 0) return models;

	return models.filter((model) => {
		const searchableText = [
			model.name,
			model.publisher,
			getPublisherDisplayName(model.publisher),
			model.description,
			model.modelType,
			model.libraryName,
			model.license,
			...model.tags,
			...model.quantizations.map((quantization) => quantization.method),
		]
			.join(" ")
			.toLowerCase();

		return terms.every((term) => searchableText.includes(term));
	});
}

function ModelCatalogSearch({
	value,
	onChange,
}: {
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<InputGroup size="sm" className="min-w-0 flex-1">
			<InputGroupInput
				type="search"
				aria-label="Search model catalog"
				placeholder="Search models"
				value={value}
				data-qa-id="model-catalog-search"
				onChange={(event) => onChange(event.currentTarget.value)}
			/>
			<InputGroupAddon>
				<SearchIcon aria-hidden="true" />
			</InputGroupAddon>
		</InputGroup>
	);
}

function ModelCatalogTable({
	models,
	hardware,
	search,
	onSearchChange,
	onSelectModel,
	selectedModelId,
}: {
	models: ModelCatalogEntry[];
	hardware: LocalInferenceHardwareProfile | undefined;
	search: string;
	onSearchChange: (value: string) => void;
	onSelectModel: (model: ModelCatalogEntry) => void;
	selectedModelId?: string | undefined;
}) {
	const [sort, setSort] = useState<CatalogSort>(defaultCatalogSort);
	const rows = useMemo(() => sortCatalogModels(models, hardware, sort), [hardware, models, sort]);
	const activeSortOption =
		catalogSortOptions.find((option) => option.value === sort) ?? catalogSortOptions[0];

	return (
		<div className="flex min-w-0 flex-col gap-4">
			<div className="flex items-center gap-2">
				<ModelCatalogSearch value={search} onChange={onSearchChange} />
				<DropdownMenu>
					<DropdownMenuTrigger
						render={
							<Button
								type="button"
								variant={sort === defaultCatalogSort ? "outline" : "secondary"}
								size="icon-sm"
								aria-label={`Sort models: ${activeSortOption.label}`}
								className="shrink-0"
								data-qa-id="model-catalog-sort"
							/>
						}
					>
						<ListFilterIcon aria-hidden="true" />
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="w-56">
						<DropdownMenuGroup>
							<DropdownMenuLabel>Sort by</DropdownMenuLabel>
							<DropdownMenuRadioGroup value={sort}>
								{catalogSortOptions.map((option) => (
									<DropdownMenuRadioItem
										key={option.value}
										value={option.value}
										closeOnClick
										onClick={() => setSort(option.value)}
									>
										{option.label}
									</DropdownMenuRadioItem>
								))}
							</DropdownMenuRadioGroup>
						</DropdownMenuGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{rows.length === 0 ? (
				<ModelCatalogNoResults onClear={() => onSearchChange("")} />
			) : (
				<ModelCatalogTableFrame data-qa-id="model-catalog-table">
					{rows.map(({ model, compatibility }) => {
						return (
							<TableRow
								key={model.id}
								className={cn(
									"focus-visible:bg-muted cursor-pointer focus-visible:outline-none",
									model.id === selectedModelId && "bg-muted",
								)}
								tabIndex={0}
								aria-selected={model.id === selectedModelId}
								aria-label={`View ${model.name} details`}
								data-qa-id={`model-catalog-select-${model.id}`}
								onClick={() => onSelectModel(model)}
								onKeyDown={(event) => {
									if (event.key === "Enter" || event.key === " ") {
										event.preventDefault();
										onSelectModel(model);
									}
								}}
							>
								<TableCell className={catalogTableCellClassNames.model}>
									<ModelIdentity model={model} />
								</TableCell>
								<TableCell className={catalogTableCellClassNames.capabilities}>
									<ModelCapabilityIndicators
										capabilities={model.capabilities}
										modelId={model.id}
										modelType={model.modelType}
									/>
								</TableCell>
								<TableCell className={catalogTableCellClassNames.performance}>
									<ModelPerformance
										compatibility={compatibility}
										hasHardware={Boolean(hardware)}
										hasQuantizations={hasRecommendationQuantization(model)}
										fixedFitWidth
										wrap
									/>
								</TableCell>
							</TableRow>
						);
					})}
				</ModelCatalogTableFrame>
			)}
		</div>
	);
}

function ModelCapabilityIndicators({
	capabilities,
	modelId,
	modelType,
}: {
	capabilities?: ModelCatalogCapabilities;
	modelId: string;
	modelType: string;
}) {
	const indicators = modelCapabilityIndicators.filter(({ id }) => capabilities?.[id]);

	if (indicators.length === 0) {
		return null;
	}

	const capabilityLabels = indicators.map(({ label }) => label).join(", ");

	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						className={cn(
							"bg-muted ring-foreground/5 inline-flex items-center rounded-full ring-1",
							indicators.length === 1 ? "size-5 justify-center" : "h-5 gap-2 px-1.5",
						)}
						aria-label={`Model type: ${modelType}. Capabilities: ${capabilityLabels}.`}
						data-qa-id={`model-catalog-capabilities-${modelId}`}
					/>
				}
			>
				{indicators.map(({ id, label, icon: Icon }) => (
					<span
						key={id}
						className="text-muted-foreground inline-flex size-3.5 items-center justify-center"
						aria-label={label}
						data-qa-id={`model-catalog-capability-${id}-${modelId}`}
					>
						<Icon className="size-3.5" aria-hidden="true" />
					</span>
				))}
			</TooltipTrigger>
			<TooltipContent className="flex-col items-start gap-1.5">
				<span className="font-medium" data-qa-id={`model-catalog-tooltip-model-type-${modelId}`}>
					{modelType}
				</span>
				<div className="flex flex-col gap-1">
					{indicators.map(({ id, label, icon: Icon }) => (
						<span
							key={id}
							className="inline-flex items-center gap-1.5"
							data-qa-id={`model-catalog-tooltip-capability-${id}-${modelId}`}
						>
							<Icon className="size-3.5" aria-hidden="true" />
							{label}
						</span>
					))}
				</div>
			</TooltipContent>
		</Tooltip>
	);
}
