import { useDeferredValue, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowUpDownIcon,
	BinaryIcon,
	EyeIcon,
	MessageCircleIcon,
	SearchIcon,
	WrenchIcon,
	type LucideIcon,
} from "lucide-react";

import { sdkQueryOptions, useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anaconda-agentic-desktop/ui/components/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@anaconda-agentic-desktop/ui/components/table";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type {
	LocalInferenceHardwareProfile,
	LocalInferenceServiceContract,
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
} from "./CatalogStates.js";
import { ModelIdentity } from "./ModelIdentity.js";
import { ModelPerformance } from "./ModelPerformance.js";
import { ModelRecommendations } from "./ModelRecommendations.js";
import { getPublisherDisplayName } from "./ModelPublisherIcon.js";

const catalogSortOptions: ReadonlyArray<{ label: string; value: CatalogSort }> = [
	{ label: "Newest", value: "newest" },
	{ label: "Estimated performance", value: "best-fit" },
	{ label: "Fastest", value: "fastest" },
	{ label: "Largest", value: "parameters-desc" },
	{ label: "Smallest", value: "parameters-asc" },
];

function isCatalogSort(value: unknown): value is CatalogSort {
	return catalogSortOptions.some((option) => option.value === value);
}

const modelCapabilityIndicators = [
	{ id: "chat", label: "Chat", icon: MessageCircleIcon },
	{ id: "toolCalling", label: "Tool Calling", icon: WrenchIcon },
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
	const sdk = useSdk<LocalInferenceServiceContract>("local-inference");
	const [search, setSearch] = useState("");
	const deferredSearch = useDeferredValue(search);
	const catalog = useQuery({
		...sdkQueryOptions(sdk, "catalog.list"),
		retry: false,
		staleTime: 5 * 60 * 1_000,
	});
	const hardware = useQuery({
		...sdkQueryOptions(sdk, "hardware.profile"),
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const filteredModels = useMemo(
		() => filterCatalogModels(catalog.data?.models ?? [], deferredSearch),
		[catalog.data?.models, deferredSearch],
	);
	const hasSearch = deferredSearch.trim().length > 0;

	return (
		<div className="@container min-w-0" data-qa-id="local-model-catalog">
			{catalog.isPending || hardware.isPending ? (
				<ModelCatalogLoading />
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
						title={hasSearch ? "Search results" : "All models"}
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
		<div className="relative w-40 min-w-0 @xl:w-56">
			<SearchIcon
				className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
				aria-hidden="true"
			/>
			<Input
				type="search"
				aria-label="Search model catalog"
				placeholder="Search models"
				className="h-7 pl-8 text-xs"
				value={value}
				data-qa-id="model-catalog-search"
				onChange={(event) => onChange(event.currentTarget.value)}
			/>
		</div>
	);
}

function ModelCatalogTable({
	title,
	models,
	hardware,
	search,
	onSearchChange,
	onSelectModel,
	selectedModelId,
}: {
	title: string;
	models: ModelCatalogEntry[];
	hardware: LocalInferenceHardwareProfile | undefined;
	search: string;
	onSearchChange: (value: string) => void;
	onSelectModel: (model: ModelCatalogEntry) => void;
	selectedModelId?: string | undefined;
}) {
	const [sort, setSort] = useState<CatalogSort>("newest");
	const rows = useMemo(() => sortCatalogModels(models, hardware, sort), [hardware, models, sort]);

	return (
		<div className="flex min-w-0 flex-col gap-2">
			<div className="flex items-center justify-between gap-3">
				<h2 className="shrink-0 text-sm font-medium">{title}</h2>
				<div className="flex min-w-0 items-center justify-end gap-2">
					<ModelCatalogSearch value={search} onChange={onSearchChange} />
					<Select
						items={catalogSortOptions}
						value={sort}
						onValueChange={(value) => {
							if (isCatalogSort(value)) setSort(value);
						}}
					>
						<SelectTrigger
							size="sm"
							className="min-w-max"
							aria-label="Sort models"
							data-qa-id="model-catalog-sort"
						>
							<ArrowUpDownIcon className="text-muted-foreground" aria-hidden="true" />
							<span className="text-muted-foreground">Sort by</span>
							<SelectValue className="font-medium" />
						</SelectTrigger>
						<SelectContent className="w-max min-w-52 whitespace-nowrap">
							<SelectGroup>
								{catalogSortOptions.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectGroup>
						</SelectContent>
					</Select>
				</div>
			</div>
			{rows.length === 0 ? (
				<ModelCatalogNoResults onClear={() => onSearchChange("")} />
			) : (
				<div
					className="border-border min-w-0 overflow-hidden rounded-lg border [&_[data-slot=table-container]]:overflow-x-hidden"
					data-qa-id="model-catalog-table"
				>
					<TooltipProvider>
						<Table className="table-fixed">
							<TableHeader>
								<TableRow>
									<TableHead scope="col" className="w-[55%] @xl:w-[44%]">
										Model
									</TableHead>
									<TableHead
										scope="col"
										className="hidden w-[20%] whitespace-normal @xl:table-cell"
									>
										Capabilities
									</TableHead>
									<TableHead scope="col" className="w-[45%] whitespace-normal @xl:w-[36%]">
										<span className="@xl:hidden">Performance</span>
										<span className="hidden @xl:inline">Estimated performance</span>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map(({ model, compatibility }) => {
									return (
										<TableRow
											key={model.id}
											className={cn(
												"hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07] cursor-pointer focus-visible:outline-none",
												model.id === selectedModelId && "bg-foreground/[0.07]",
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
											<TableCell className="max-w-md overflow-hidden whitespace-normal">
												<ModelIdentity model={model} />
											</TableCell>
											<TableCell className="hidden overflow-hidden whitespace-normal @xl:table-cell">
												<ModelCapabilityIndicators
													capabilities={model.capabilities}
													modelId={model.id}
													modelType={model.modelType}
												/>
											</TableCell>
											<TableCell className="overflow-hidden whitespace-normal">
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
							</TableBody>
						</Table>
					</TooltipProvider>
				</div>
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
