import {
	useDeferredValue,
	useMemo,
	useState,
	type ComponentProps,
	type ComponentType,
} from "react";
import Ai2Color from "@lobehub/icons/es/Ai2/components/Color.js";
import AlibabaColor from "@lobehub/icons/es/Alibaba/components/Color.js";
import BAAIMono from "@lobehub/icons/es/BAAI/components/Mono.js";
import CohereColor from "@lobehub/icons/es/Cohere/components/Color.js";
import DeepSeekColor from "@lobehub/icons/es/DeepSeek/components/Color.js";
import DolphinMono from "@lobehub/icons/es/Dolphin/components/Mono.js";
import GoogleColor from "@lobehub/icons/es/Google/components/Color.js";
import HuggingFaceColor from "@lobehub/icons/es/HuggingFace/components/Color.js";
import IBMMono from "@lobehub/icons/es/IBM/components/Mono.js";
import KimiColor from "@lobehub/icons/es/Kimi/components/Color.js";
import MetaColor from "@lobehub/icons/es/Meta/components/Color.js";
import MicrosoftColor from "@lobehub/icons/es/Microsoft/components/Color.js";
import MinimaxColor from "@lobehub/icons/es/Minimax/components/Color.js";
import MistralColor from "@lobehub/icons/es/Mistral/components/Color.js";
import NvidiaColor from "@lobehub/icons/es/Nvidia/components/Color.js";
import OpenAIMono from "@lobehub/icons/es/OpenAI/components/Mono.js";
import QwenColor from "@lobehub/icons/es/Qwen/components/Color.js";
import StabilityColor from "@lobehub/icons/es/Stability/components/Color.js";
import XiaomiMiMoMono from "@lobehub/icons/es/XiaomiMiMo/components/Mono.js";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowUpDownIcon,
	BinaryIcon,
	CircleAlertIcon,
	Code2Icon,
	EyeIcon,
	GaugeIcon,
	LibraryIcon,
	MessageCircleIcon,
	RefreshCwIcon,
	SearchIcon,
	SearchXIcon,
	WrenchIcon,
	type LucideIcon,
} from "lucide-react";

import { sdkQueryOptions, useSdk } from "@anaconda-agentic-desktop/sdk-react";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@anaconda-agentic-desktop/ui/components/empty";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
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
} from "../contracts/schemas.js";
import {
	getCatalogRecommendations,
	hasRecommendationQuantization,
	sortCatalogModels,
	type CatalogSort,
	type ModelCompatibility,
	type ModelFit,
	type ModelRecommendation,
} from "../shared/model-compatibility.js";

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

type PublisherLogoComponent = ComponentType<{
	className?: string;
	size?: number | string;
}>;

type PublisherPresentation = {
	displayName: string;
	logo?: PublisherLogoComponent;
	iconClassName?: string;
};

const publisherPresentations: Record<string, PublisherPresentation> = {
	ai2: { displayName: "Ai2", logo: Ai2Color },
	alibaba: { displayName: "Alibaba", logo: AlibabaColor },
	alibabacloud: { displayName: "Alibaba Cloud", logo: AlibabaColor },
	allenai: { displayName: "Ai2", logo: Ai2Color },
	baai: { displayName: "BAAI", logo: BAAIMono },
	cohere: { displayName: "Cohere", logo: CohereColor },
	cohereforai: { displayName: "Cohere For AI", logo: CohereColor },
	deepseek: { displayName: "DeepSeek", logo: DeepSeekColor },
	deepseekai: { displayName: "DeepSeek", logo: DeepSeekColor },
	dolphin: { displayName: "Dolphin", logo: DolphinMono },
	dphn: { displayName: "Dolphin", logo: DolphinMono },
	google: { displayName: "Google", logo: GoogleColor, iconClassName: "translate-y-px" },
	googledeepmind: {
		displayName: "Google DeepMind",
		logo: GoogleColor,
		iconClassName: "translate-y-px",
	},
	huggingface: { displayName: "Hugging Face", logo: HuggingFaceColor },
	ibm: { displayName: "IBM", logo: IBMMono },
	ibmgranite: { displayName: "IBM Granite", logo: IBMMono },
	ibmresearch: { displayName: "IBM Research", logo: IBMMono },
	kimi: { displayName: "Moonshot AI", logo: KimiColor },
	meta: { displayName: "Meta", logo: MetaColor },
	metaai: { displayName: "Meta", logo: MetaColor },
	metallama: { displayName: "Meta", logo: MetaColor },
	metamodels: { displayName: "Meta", logo: MetaColor },
	microsoft: { displayName: "Microsoft", logo: MicrosoftColor },
	minimax: { displayName: "MiniMax", logo: MinimaxColor },
	minimaxai: { displayName: "MiniMax", logo: MinimaxColor },
	mistral: { displayName: "Mistral AI", logo: MistralColor },
	mistralai: { displayName: "Mistral AI", logo: MistralColor },
	moonshotai: { displayName: "Moonshot AI", logo: KimiColor },
	nvidia: { displayName: "NVIDIA", logo: NvidiaColor },
	nvidianemotron: { displayName: "NVIDIA", logo: NvidiaColor },
	openai: { displayName: "OpenAI", logo: OpenAIMono },
	openaicommunity: { displayName: "OpenAI", logo: OpenAIMono },
	qwen: { displayName: "Qwen", logo: QwenColor },
	stability: { displayName: "Stability AI", logo: StabilityColor },
	stabilityai: { displayName: "Stability AI", logo: StabilityColor },
	tinyllama: { displayName: "TinyLlama" },
	xiaomimimo: { displayName: "Xiaomi MiMo", logo: XiaomiMiMoMono },
};

function getPublisherPresentation(publisher: string): PublisherPresentation {
	const normalizedPublisher = publisher.toLowerCase().replaceAll(/[^a-z0-9]/g, "");
	return publisherPresentations[normalizedPublisher] ?? { displayName: publisher };
}

export function getPublisherDisplayName(publisher: string): string {
	return getPublisherPresentation(publisher).displayName;
}

function getPublisherInitials(publisher: string): string {
	const words = publisher.trim().split(/\s+/).filter(Boolean);

	if (words.length > 1) {
		return `${words[0]?.[0] ?? ""}${words[1]?.[0] ?? ""}`.toUpperCase();
	}

	return publisher.slice(0, 2).toUpperCase();
}

export function ModelPublisherIcon({
	publisher,
	size = "default",
	className,
	...props
}: {
	publisher: string;
	size?: "default" | "lg";
} & Omit<ComponentProps<"span">, "children">) {
	const presentation = getPublisherPresentation(publisher);
	const PublisherLogo = presentation.logo;
	const iconSize = size === "lg" ? 16 : 14;

	return (
		<span
			{...props}
			data-slot="publisher-icon"
			aria-hidden="true"
			className={cn(
				"text-muted-foreground inline-flex shrink-0 items-center justify-center font-medium",
				size === "lg" ? "size-4 text-xs" : "size-3.5 text-[0.625rem]",
				presentation.iconClassName,
				className,
			)}
		>
			{PublisherLogo ? (
				<PublisherLogo className={size === "lg" ? "size-4" : "size-3.5"} size={iconSize} />
			) : (
				getPublisherInitials(publisher)
			)}
		</span>
	);
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

function ModelIdentity({
	model,
	compact = false,
}: {
	model: ModelCatalogEntry;
	compact?: boolean;
}) {
	const publisher = getPublisherPresentation(model.publisher);

	return (
		<div className="flex min-w-0 flex-col gap-0.5">
			<div className={cn("flex min-w-0 items-center gap-1.5 font-medium", compact && "text-sm")}>
				<ModelPublisherIcon publisher={model.publisher} />
				<span className="truncate">{model.name}</span>
			</div>
			<span
				className="text-muted-foreground truncate text-xs"
				data-qa-id={compact ? "recommended-model-publisher" : "model-publisher"}
			>
				{publisher.displayName}
			</span>
		</div>
	);
}

type PerformanceFitKind = ModelFit | "doesnt-fit";

const performanceFitMarkerClasses: Record<PerformanceFitKind, string> = {
	"runs-great": "bg-emerald-500",
	"runs-well": "bg-sky-500",
	"tight-fit": "bg-amber-500",
	"runs-slowly": "bg-orange-500",
	"doesnt-fit": "bg-red-500",
};

function PerformanceFitIndicator({
	kind,
	label,
	className,
}: {
	kind: PerformanceFitKind;
	label: string;
	className?: string | undefined;
}) {
	return (
		<span className={cn("inline-flex items-center gap-2 text-xs font-medium", className)}>
			<span
				className={cn("size-2 shrink-0 rounded-full", performanceFitMarkerClasses[kind])}
				aria-hidden="true"
			/>
			<span>{label}</span>
		</span>
	);
}

export function ModelPerformance({
	compatibility,
	hasHardware,
	hasQuantizations,
	fixedFitWidth = false,
	wrap = false,
	stackOnNarrow = false,
}: {
	compatibility: ModelCompatibility | null;
	hasHardware: boolean;
	hasQuantizations: boolean;
	fixedFitWidth?: boolean;
	wrap?: boolean;
	stackOnNarrow?: boolean;
}) {
	const fitClassName = fixedFitWidth ? "w-24" : undefined;

	if (!hasHardware) {
		return <span className="text-muted-foreground text-xs">Checking machine…</span>;
	}

	if (!compatibility) {
		if (hasQuantizations) {
			return (
				<PerformanceFitIndicator kind="doesnt-fit" label="Doesn’t Fit" className={fitClassName} />
			);
		}

		return <span className="text-muted-foreground text-xs">No GGUF estimate</span>;
	}

	return (
		<div
			data-slot="model-performance"
			className={cn(
				"flex min-w-0 items-center gap-x-3 gap-y-1",
				wrap ? "flex-wrap" : "shrink-0",
				stackOnNarrow && "flex-col items-start @xl:flex-row @xl:items-center",
			)}
		>
			<PerformanceFitIndicator
				kind={compatibility.fit}
				label={compatibility.fitLabel}
				className={fitClassName}
			/>
			{compatibility.estimatedTokensPerSecond ? (
				<div className="text-muted-foreground flex flex-col text-xs leading-tight tabular-nums">
					<span className="text-foreground font-medium">
						~{compatibility.estimatedTokensPerSecond[0]}–{compatibility.estimatedTokensPerSecond[1]}
					</span>
					<span>tokens/sec</span>
				</div>
			) : null}
		</div>
	);
}

function ModelRecommendations({
	models,
	hardware,
	onSelectModel,
	selectedModelId,
}: {
	models: ModelCatalogEntry[];
	hardware: LocalInferenceHardwareProfile;
	onSelectModel: (model: ModelCatalogEntry) => void;
	selectedModelId?: string | undefined;
}) {
	const recommendations = getCatalogRecommendations(models, hardware);

	return (
		<TooltipProvider>
			<section className="mb-6" data-qa-id="model-recommendations">
				<h2 className="mb-3 text-sm font-semibold">Recommended Models</h2>
				<div className="grid gap-3 lg:grid-cols-2">
					<RecommendationGroup
						icon={Code2Icon}
						title="Chat & coding"
						recommendations={recommendations.coding}
						onSelectModel={onSelectModel}
						selectedModelId={selectedModelId}
					/>
					<RecommendationGroup
						icon={GaugeIcon}
						title="Lightweight models"
						recommendations={recommendations.small}
						onSelectModel={onSelectModel}
						selectedModelId={selectedModelId}
					/>
				</div>
			</section>
		</TooltipProvider>
	);
}

function RecommendationGroup({
	icon: Icon,
	title,
	recommendations,
	onSelectModel,
	selectedModelId,
}: {
	icon: LucideIcon;
	title: string;
	recommendations: readonly ModelRecommendation[];
	onSelectModel: (model: ModelCatalogEntry) => void;
	selectedModelId?: string | undefined;
}) {
	return (
		<div className="border-border bg-card min-w-0 rounded-xl border px-4 pt-3 pb-4">
			<div className="mb-2 flex items-center gap-2">
				<Icon className="text-primary size-4" aria-hidden="true" />
				<h3 className="text-sm font-semibold">{title}</h3>
			</div>
			{recommendations.length === 0 ? (
				<p className="text-muted-foreground py-4 text-sm">
					No compatible GGUF models are available in this category.
				</p>
			) : (
				<div className="divide-border divide-y">
					{recommendations.map(({ model, compatibility }) => (
						<Button
							key={model.id}
							type="button"
							variant="ghost"
							className="hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07] aria-pressed:bg-foreground/[0.07] -mx-2 h-auto w-[calc(100%+1rem)] min-w-0 justify-between gap-4 overflow-hidden rounded-lg px-2 py-2.5 text-left last:-mb-2"
							aria-pressed={model.id === selectedModelId}
							aria-label={`View ${model.name} details`}
							data-qa-id={`recommended-model-${model.id}`}
							onClick={() => onSelectModel(model)}
						>
							<ModelIdentity model={model} compact />
							<ModelPerformance
								compatibility={compatibility}
								hasHardware
								hasQuantizations={model.quantizations.length > 0}
								stackOnNarrow
							/>
						</Button>
					))}
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

function ModelCatalogLoading() {
	return (
		<div
			className="[&_[data-slot=skeleton]]:bg-muted-foreground/25 flex flex-col gap-6"
			aria-label="Loading model catalog"
			data-qa-id="model-catalog-loading"
		>
			<section>
				<Skeleton className="mb-3 h-4 w-36" />
				<div className="grid gap-3 lg:grid-cols-2">
					{["coding", "lightweight"].map((group) => (
						<div key={group} className="border-border flex flex-col gap-3 rounded-lg border p-3">
							<div className="flex items-center gap-2">
								<Skeleton className="size-4 rounded-sm" />
								<Skeleton className="h-3.5 w-28" />
							</div>
							<Skeleton className="h-10 w-full" />
						</div>
					))}
				</div>
			</section>
			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<Skeleton className="h-4 w-20" />
					<div className="flex items-center gap-2">
						<Skeleton className="h-7 w-40 rounded-lg" />
						<Skeleton className="h-7 w-36 rounded-lg" />
					</div>
				</div>
				<div className="border-border overflow-hidden rounded-lg border">
					<div className="border-border grid h-10 grid-cols-[minmax(0,1fr)_8rem] items-center gap-4 border-b px-3">
						<Skeleton className="h-3 w-16" />
						<Skeleton className="h-3 w-20" />
					</div>
					{["first", "second", "third", "fourth"].map((row) => (
						<div
							key={row}
							className="border-border grid h-16 grid-cols-[minmax(0,1fr)_8rem] items-center gap-4 border-b px-3 last:border-b-0"
						>
							<div className="flex min-w-0 items-center gap-2">
								<Skeleton className="size-3.5 shrink-0 rounded-sm" />
								<div className="flex min-w-0 flex-1 flex-col gap-1.5">
									<Skeleton className={row === "second" ? "h-3.5 w-3/5" : "h-3.5 w-4/5"} />
									<Skeleton className="h-2.5 w-20" />
								</div>
							</div>
							<Skeleton className="h-5 w-24 rounded-full" />
						</div>
					))}
				</div>
			</section>
		</div>
	);
}

function ModelCatalogNoResults({ onClear }: { onClear: () => void }) {
	return (
		<Empty
			className="min-h-48 gap-3 rounded-lg border border-dashed p-4"
			data-qa-id="model-catalog-search-empty"
		>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<SearchXIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>No matching models</EmptyTitle>
				<EmptyDescription>Try a different model name or publisher.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button type="button" variant="outline" size="sm" onClick={onClear}>
					Clear search
				</Button>
			</EmptyContent>
		</Empty>
	);
}

function ModelCatalogError({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<Empty data-qa-id="model-catalog-error">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<CircleAlertIcon />
				</EmptyMedia>
				<EmptyTitle>Could not load models</EmptyTitle>
				<EmptyDescription>{message}</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button variant="outline" onClick={onRetry}>
					<RefreshCwIcon data-icon="inline-start" />
					Try again
				</Button>
			</EmptyContent>
		</Empty>
	);
}

function ModelCatalogEmpty() {
	return (
		<Empty data-qa-id="model-catalog-empty">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<LibraryIcon />
				</EmptyMedia>
				<EmptyTitle>No models available</EmptyTitle>
				<EmptyDescription>Your Anaconda account has no models available.</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
