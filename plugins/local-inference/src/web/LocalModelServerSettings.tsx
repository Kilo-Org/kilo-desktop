import {
	BinaryIcon,
	CheckIcon,
	ChevronDownIcon,
	EyeIcon,
	FileUpIcon,
	LibraryIcon,
	ListFilterIcon,
	LoaderCircleIcon,
	LogInIcon,
	MessageCircleIcon,
	PlusIcon,
	RotateCcwIcon,
	SearchIcon,
	SearchXIcon,
	Trash2Icon,
	WrenchIcon,
	XIcon,
} from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
	sdkQueryKey,
	sdkQueryOptions,
	useSdk,
	useSdkMutation,
	useSdkQuery,
} from "@anaconda-agentic-desktop/sdk-react";
import { Badge } from "@anaconda-agentic-desktop/ui/components/badge";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@anaconda-agentic-desktop/ui/components/alert-dialog";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@anaconda-agentic-desktop/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@anaconda-agentic-desktop/ui/components/empty";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@anaconda-agentic-desktop/ui/components/field";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import { ScrollArea } from "@anaconda-agentic-desktop/ui/components/scroll-area";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anaconda-agentic-desktop/ui/components/select";
import { Separator } from "@anaconda-agentic-desktop/ui/components/separator";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { Switch } from "@anaconda-agentic-desktop/ui/components/switch";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type {
	LocalInferenceServiceContract,
	LocalInferenceHardwareProfile,
	LocalInferenceStatus,
	ModelDownload,
	LocalModel,
	LocalModelSettings,
	ModelCatalogEntry,
} from "../contracts/schemas.js";
import { modelDownloadSchema } from "../contracts/schemas.js";
import {
	CATALOG_DOWNLOAD_CHANGED_EVENT,
	MODELS_CHANGED_EVENT,
	STATUS_CHANGED_EVENT,
} from "../shared/constants.js";
import { evaluateCatalogModel } from "../shared/model-compatibility.js";
import { ConnectionDetails } from "./ConnectionDetails.js";
import {
	getPublisherDisplayName,
	LocalModelCatalog,
	ModelPerformance,
	ModelPublisherIcon,
} from "./LocalModelCatalogSettings.js";
import { ModelSettingsPanel } from "./ModelSettingsPanel.js";
import { ModelSidebar } from "./ModelSidebar.js";
import { ServerSettings } from "./ServerSettings.js";
import { SystemMonitor } from "./SystemMonitor.js";

type ServerStatusPresentation = {
	label: string;
	indicatorClass: string;
	checked: boolean;
};

type DownloadIdentity = Pick<ModelDownload, "modelId" | "quantizationId">;

const modelSourceFilters = [
	{ value: "all", label: "All models" },
	{ value: "catalog", label: "Catalog models" },
	{ value: "imported", label: "Imported models" },
] as const;

type ModelSourceFilter = (typeof modelSourceFilters)[number]["value"];

function filterLocalModels(
	models: readonly LocalModel[],
	search: string,
	source: ModelSourceFilter,
): LocalModel[] {
	const normalizedSearch = search.trim().toLocaleLowerCase();
	return models.filter((model) => {
		if (source === "catalog" && !model.catalog) return false;
		if (source === "imported" && model.catalog) return false;
		if (!normalizedSearch) return true;

		return [model.name, model.path, model.catalog?.publisher]
			.filter((value): value is string => Boolean(value))
			.some((value) => value.toLocaleLowerCase().includes(normalizedSearch));
	});
}

function catalogArtifactKey(identity: DownloadIdentity): string {
	return `${identity.modelId}\u0000${identity.quantizationId}`;
}

function upsertDownload(
	downloads: readonly ModelDownload[] | undefined,
	download: ModelDownload,
): ModelDownload[] {
	const current = downloads ?? [];
	const key = catalogArtifactKey(download);
	return [...current.filter((entry) => catalogArtifactKey(entry) !== key), download];
}

const interactiveScrollbarClassName =
	"[&_[data-slot=scroll-area-scrollbar]]:opacity-0 hover:[&_[data-slot=scroll-area-scrollbar]]:opacity-100 focus-within:[&_[data-slot=scroll-area-scrollbar]]:opacity-100";

function formatParameterCount(parameters: number): string {
	const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

	if (parameters >= 1_000_000_000) {
		return `${numberFormatter.format(parameters / 1_000_000_000)}B`;
	}

	if (parameters >= 1_000_000) {
		return `${numberFormatter.format(parameters / 1_000_000)}M`;
	}

	return numberFormatter.format(parameters);
}

const fileSizeFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function formatFileSize(bytes: number): string {
	const gibibyte = 1024 ** 3;
	return `${fileSizeFormatter.format(bytes / gibibyte)} GB`;
}

function ModelListSkeleton() {
	return (
		<div
			className="[&_[data-slot=skeleton]]:bg-muted-foreground/25 flex flex-col gap-px"
			aria-label="Loading models"
			data-qa-id="local-model-list-skeleton"
		>
			<div className="flex items-center gap-1 pb-2">
				<Skeleton className="h-7 min-w-0 flex-1 rounded-lg" />
				<Skeleton className="size-7 shrink-0 rounded-lg" />
			</div>
			{["first", "second"].map((row) => (
				<div key={row} className="flex h-12 items-center gap-2 p-2">
					<Skeleton className="size-4 shrink-0 rounded-sm" />
					<div className="flex min-w-0 flex-1 flex-col gap-1.5">
						<Skeleton className={row === "first" ? "h-3.5 w-4/5" : "h-3.5 w-3/5"} />
						<Skeleton className="h-2.5 w-20" />
					</div>
				</div>
			))}
		</div>
	);
}

function ModelSettingsSkeleton() {
	return (
		<div
			className="border-border [&_[data-slot=skeleton]]:bg-muted-foreground/25 min-w-0 overflow-hidden rounded-lg border"
			aria-label="Loading model settings"
			data-qa-id="local-model-settings-skeleton"
		>
			<div className="px-3 py-3">
				<Skeleton className="h-4 w-20" />
			</div>
			<div className="border-border flex flex-col gap-5 border-t px-3 py-4">
				<div className="flex items-center justify-between gap-4">
					<div className="flex flex-1 flex-col gap-2">
						<Skeleton className="h-3.5 w-40" />
						<Skeleton className="h-3 w-4/5" />
					</div>
					<Skeleton className="h-5 w-9 rounded-full" />
				</div>
				{["context", "temperature", "tokens"].map((setting) => (
					<div key={setting} className="flex flex-col gap-2">
						<div className="flex items-center justify-between">
							<Skeleton className="h-3.5 w-24" />
							<Skeleton className="h-7 w-24" />
						</div>
						<Skeleton className="h-1.5 w-full rounded-full" />
					</div>
				))}
			</div>
		</div>
	);
}

function NoModelsEmptyState({ failed }: { failed: boolean }) {
	return (
		<Empty className="min-h-40 gap-3 p-4" data-qa-id="local-model-list-empty">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<LibraryIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>{failed ? "Models could not be loaded" : "No models added"}</EmptyTitle>
				<EmptyDescription>
					{failed
						? "Try reopening this page."
						: "Add a model from the catalog or import a GGUF file to get started."}
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

function NoMatchingModelsState({ onClear }: { onClear: () => void }) {
	return (
		<Empty
			className="min-h-40 gap-3 rounded-lg border border-dashed p-4"
			data-qa-id="local-model-filter-empty"
		>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<SearchXIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>No matching models</EmptyTitle>
				<EmptyDescription>Try a different search or model source.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button type="button" variant="outline" size="sm" onClick={onClear}>
					Clear filters
				</Button>
			</EmptyContent>
		</Empty>
	);
}

const capabilityBadgeDefinitions = [
	{ id: "chat", label: "Chat", icon: MessageCircleIcon },
	{ id: "toolCalling", label: "Tool calling", icon: WrenchIcon },
	{ id: "vision", label: "Vision", icon: EyeIcon },
	{ id: "embedding", label: "Embeddings", icon: BinaryIcon },
] as const;

function ModelDownloadSection({
	model,
	hardware,
	downloads,
	addedCatalogArtifacts,
	onStart,
	onCancel,
	onDelete,
}: {
	model: ModelCatalogEntry;
	hardware: LocalInferenceHardwareProfile | undefined;
	downloads: readonly ModelDownload[];
	addedCatalogArtifacts: ReadonlyMap<string, LocalModel>;
	onStart: (identity: DownloadIdentity) => Promise<ModelDownload>;
	onCancel: (identity: DownloadIdentity) => Promise<ModelDownload>;
	onDelete: (model: LocalModel) => void;
}) {
	const [selectedQuantizationId, setSelectedQuantizationId] = useState<string | null>(null);
	const [startingKey, setStartingKey] = useState<string>();
	const [cancellingKey, setCancellingKey] = useState<string>();
	const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
	const hasQuantizations = model.quantizations.length > 0;
	const recommendedCompatibility = hardware ? evaluateCatalogModel(model, hardware) : null;
	const activeQuantizationId =
		selectedQuantizationId ??
		recommendedCompatibility?.quantization.id ??
		model.quantizations[0]?.id ??
		null;
	const selectedQuantization = model.quantizations.find(
		(quantization) => quantization.id === activeQuantizationId,
	);
	const compatibility =
		hardware && selectedQuantization
			? evaluateCatalogModel({ ...model, quantizations: [selectedQuantization] }, hardware)
			: null;
	const doesNotFit = Boolean(hardware && selectedQuantization && !compatibility);
	const quantizationOptions = model.quantizations.map((quantization) => ({
		label: quantization.method,
		value: quantization.id,
	}));
	const identity = selectedQuantization
		? { modelId: model.id, quantizationId: selectedQuantization.id }
		: undefined;
	const artifactKey = identity ? catalogArtifactKey(identity) : undefined;
	const download = identity
		? downloads.find(
				(entry) =>
					entry.modelId === identity.modelId && entry.quantizationId === identity.quantizationId,
			)
		: undefined;
	const addedModel = artifactKey ? addedCatalogArtifacts.get(artifactKey) : undefined;
	const starting = artifactKey === startingKey && download?.status !== "downloading";
	const cancelling = artifactKey === cancellingKey || download?.status === "cancelling";
	const downloading = starting || download?.status === "downloading";
	const failed = download?.status === "failed";
	const percentage = starting ? 0 : (download?.percentage ?? 0);
	const actionError = (artifactKey ? actionErrors[artifactKey] : undefined) ?? download?.error;
	const updateError = (key: string, error: string | undefined) => {
		setActionErrors((current) => {
			const next = { ...current };
			if (error) next[key] = error;
			else delete next[key];
			return next;
		});
	};
	const startDownload = async () => {
		if (!identity || !artifactKey) return;
		updateError(artifactKey, undefined);
		setStartingKey(artifactKey);
		try {
			await onStart(identity);
		} catch (error) {
			updateError(artifactKey, error instanceof Error ? error.message : String(error));
		} finally {
			setStartingKey((current) => (current === artifactKey ? undefined : current));
		}
	};
	const cancelDownload = async () => {
		if (!identity || !artifactKey || download?.status !== "downloading") return;
		updateError(artifactKey, undefined);
		setCancellingKey(artifactKey);
		try {
			await onCancel(identity);
		} catch (error) {
			updateError(artifactKey, error instanceof Error ? error.message : String(error));
		} finally {
			setCancellingKey((current) => (current === artifactKey ? undefined : current));
		}
	};

	return (
		<section
			className="flex w-full flex-col gap-4"
			aria-labelledby="model-download-title"
			data-qa-id="model-catalog-download-controls"
		>
			<div className="flex flex-col gap-1">
				<h2 id="model-download-title" className="text-sm font-medium">
					Add to model server
				</h2>
				<p className="text-muted-foreground text-sm">
					Choose a quantization to add this model to your local server.
				</p>
			</div>
			<FieldGroup>
				<Field data-invalid={Boolean(actionError) || undefined}>
					<FieldLabel className="sr-only" htmlFor="model-download-quantization">
						Quantization
					</FieldLabel>
					<div className="flex items-center gap-3">
						<Select
							items={quantizationOptions}
							value={activeQuantizationId}
							onValueChange={setSelectedQuantizationId}
							disabled={!hasQuantizations}
						>
							<SelectTrigger
								id="model-download-quantization"
								className="min-w-0 flex-1"
								data-qa-id="model-catalog-quantization-select"
							>
								<SelectValue placeholder="No quantizations available">
									{() =>
										selectedQuantization ? (
											<>
												<span className="min-w-0 flex-1 truncate">
													{selectedQuantization.method}
												</span>
												<Badge variant="outline" className="text-muted-foreground tabular-nums">
													{formatFileSize(selectedQuantization.sizeBytes)}
												</Badge>
											</>
										) : (
											"No quantizations available"
										)
									}
								</SelectValue>
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{model.quantizations.map((quantization) => {
										const fileSize = formatFileSize(quantization.sizeBytes);
										return (
											<SelectItem
												key={quantization.id}
												value={quantization.id}
												aria-label={`${quantization.method}, ${fileSize}`}
											>
												<span className="min-w-0 flex-1">{quantization.method}</span>
												<Badge variant="outline" className="text-muted-foreground tabular-nums">
													{fileSize}
												</Badge>
											</SelectItem>
										);
									})}
								</SelectGroup>
							</SelectContent>
						</Select>
						{addedModel?.managedFile ? (
							<div className="flex shrink-0 items-center gap-1">
								<span
									className="text-muted-foreground inline-flex h-8 items-center gap-1.5 text-sm font-medium"
									data-qa-id="model-catalog-download"
								>
									<CheckIcon className="size-4" data-icon="inline-start" aria-hidden="true" />
									Added
								</span>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() => onDelete(addedModel)}
									aria-label={`Delete downloaded file for ${addedModel.name}`}
									data-qa-id="model-catalog-delete"
								>
									<Trash2Icon aria-hidden="true" />
								</Button>
							</div>
						) : addedModel ? (
							<span
								className="text-muted-foreground inline-flex h-8 shrink-0 items-center gap-1.5 text-sm font-medium"
								data-qa-id="model-catalog-download"
							>
								<CheckIcon className="size-4" data-icon="inline-start" aria-hidden="true" />
								Added
							</span>
						) : downloading || cancelling ? (
							<div className="flex shrink-0 items-center gap-1">
								<span
									className="text-muted-foreground inline-flex h-8 items-center gap-1.5 text-sm font-medium"
									role="status"
									aria-live="polite"
									data-qa-id="model-catalog-download"
								>
									<LoaderCircleIcon
										className="size-4 animate-spin"
										data-icon="inline-start"
										aria-hidden="true"
									/>
									<span>
										Downloading{" "}
										<span className="inline-block w-[4ch] text-right tabular-nums">
											{percentage}%
										</span>
									</span>
								</span>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									disabled={starting || cancelling}
									onClick={() => void cancelDownload()}
									aria-label={
										cancelling ? "Cancelling download" : `Cancel download at ${percentage}%`
									}
									data-qa-id="model-catalog-download-cancel"
								>
									{cancelling ? (
										<LoaderCircleIcon className="animate-spin" aria-hidden="true" />
									) : (
										<XIcon aria-hidden="true" />
									)}
								</Button>
							</div>
						) : (
							<Button
								type="button"
								disabled={!hasQuantizations || doesNotFit}
								aria-describedby={doesNotFit ? "model-download-does-not-fit" : undefined}
								onClick={() => void startDownload()}
								data-qa-id="model-catalog-download"
							>
								{failed || actionError ? (
									<>
										<RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
										Retry
									</>
								) : (
									<>
										<PlusIcon data-icon="inline-start" aria-hidden="true" />
										Add model
									</>
								)}
							</Button>
						)}
					</div>
					{doesNotFit ? (
						<FieldDescription id="model-download-does-not-fit" className="text-xs">
							This quantization needs more memory than this machine can safely use.
						</FieldDescription>
					) : null}
					{actionError ? <FieldError>{actionError}</FieldError> : null}
				</Field>
			</FieldGroup>
			<div className="flex items-center justify-between gap-3">
				<span className="text-muted-foreground text-xs">Estimated performance</span>
				<ModelPerformance
					compatibility={compatibility}
					hasHardware={Boolean(hardware)}
					hasQuantizations={Boolean(selectedQuantization)}
				/>
			</div>
		</section>
	);
}

function ModelDetailsSection({ model }: { model: ModelCatalogEntry }) {
	const details = [
		{ label: "Parameters", value: formatParameterCount(model.numParameters) },
		{ label: "Context Window", value: `${model.contextWindowSize.toLocaleString("en-US")} tokens` },
		{ label: "License", value: model.license },
		{ label: "Purpose", value: model.modelType },
	];
	const capabilities = capabilityBadgeDefinitions.filter(({ id }) => model.capabilities[id]);

	return (
		<section className="flex w-full flex-col gap-4" aria-labelledby="model-details-title">
			<h2 id="model-details-title" className="text-sm font-medium">
				Details
			</h2>
			<p
				className="text-muted-foreground leading-relaxed"
				data-qa-id="model-catalog-details-content"
			>
				{model.description}
			</p>
			<dl className="grid grid-cols-2 gap-x-6 gap-y-4" data-qa-id="model-catalog-metadata">
				{details.map((detail) => (
					<div key={detail.label} className="flex min-w-0 flex-col gap-1">
						<dt className="text-muted-foreground text-xs">{detail.label}</dt>
						<dd className="font-medium break-words">{detail.value}</dd>
					</div>
				))}
				<div className="col-span-2 flex min-w-0 flex-col gap-2">
					<dt className="text-muted-foreground text-xs">Capabilities</dt>
					<dd className="flex flex-wrap gap-2">
						{capabilities.length > 0 ? (
							capabilities.map(({ id, label, icon: Icon }) => (
								<Badge key={id} variant="secondary">
									<Icon data-icon="inline-start" aria-hidden="true" />
									{label}
								</Badge>
							))
						) : (
							<span className="text-muted-foreground">None listed</span>
						)}
					</dd>
				</div>
			</dl>
		</section>
	);
}

function ModelDetailPane({
	model,
	hardware,
	downloads,
	addedCatalogArtifacts,
	onStartDownload,
	onCancelDownload,
	onDeleteModel,
}: {
	model: ModelCatalogEntry;
	hardware: LocalInferenceHardwareProfile | undefined;
	downloads: readonly ModelDownload[];
	addedCatalogArtifacts: ReadonlyMap<string, LocalModel>;
	onStartDownload: (identity: DownloadIdentity) => Promise<ModelDownload>;
	onCancelDownload: (identity: DownloadIdentity) => Promise<ModelDownload>;
	onDeleteModel: (model: LocalModel) => void;
}) {
	return (
		<ScrollArea
			className={cn("size-full min-h-0", interactiveScrollbarClassName)}
			data-qa-id="model-catalog-detail-pane"
		>
			<div className="flex flex-col gap-6 p-4" data-qa-id={`model-catalog-detail-${model.id}`}>
				<div
					className="flex h-10 min-w-0 flex-col justify-center gap-0.5"
					data-qa-id="model-catalog-detail-identity"
				>
					<div className="flex min-w-0 items-center gap-1.5">
						<ModelPublisherIcon
							publisher={model.publisher}
							size="lg"
							data-qa-id="model-catalog-detail-publisher"
						/>
						<h2 className="truncate text-base leading-tight font-medium">{model.name}</h2>
					</div>
					<p className="text-muted-foreground truncate text-sm leading-tight">
						{getPublisherDisplayName(model.publisher)}
					</p>
				</div>
				<ModelDownloadSection
					key={model.id}
					model={model}
					hardware={hardware}
					downloads={downloads}
					addedCatalogArtifacts={addedCatalogArtifacts}
					onStart={onStartDownload}
					onCancel={onCancelDownload}
					onDelete={onDeleteModel}
				/>
				<ModelDetailsSection model={model} />
			</div>
		</ScrollArea>
	);
}

function ModelDetailEmpty() {
	return (
		<Empty className="h-full rounded-none" data-qa-id="model-catalog-detail-empty">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<LibraryIcon />
				</EmptyMedia>
				<EmptyTitle>Select a model</EmptyTitle>
				<EmptyDescription>Choose a model from the catalog to view its details.</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

function ModelDetailSkeleton() {
	return (
		<div
			className="[&_[data-slot=skeleton]]:bg-muted-foreground/25 flex h-full flex-col gap-6 p-4"
			aria-label="Loading model details"
			data-qa-id="model-catalog-detail-loading"
		>
			<div className="flex h-10 flex-col justify-center gap-1.5">
				<div className="flex items-center gap-2">
					<Skeleton className="size-4 rounded-sm" />
					<Skeleton className="h-4 w-44" />
				</div>
				<Skeleton className="h-3 w-24" />
			</div>
			<section className="flex w-full flex-col gap-4">
				<div className="flex flex-col gap-2">
					<Skeleton className="h-3.5 w-36" />
					<Skeleton className="h-3 w-4/5" />
				</div>
				<div className="flex items-center gap-3">
					<Skeleton className="h-8 min-w-0 flex-1 rounded-lg" />
					<Skeleton className="h-8 w-28 rounded-lg" />
				</div>
				<div className="flex items-center justify-between gap-3">
					<Skeleton className="h-3 w-32" />
					<Skeleton className="h-5 w-24 rounded-full" />
				</div>
			</section>
			<section className="flex w-full flex-col gap-4">
				<Skeleton className="h-3.5 w-16" />
				<div className="flex flex-col gap-2">
					<Skeleton className="h-3 w-full" />
					<Skeleton className="h-3 w-11/12" />
					<Skeleton className="h-3 w-3/4" />
				</div>
				<div className="grid grid-cols-2 gap-x-6 gap-y-4">
					{["parameters", "type", "context", "license"].map((detail) => (
						<div key={detail} className="flex flex-col gap-2">
							<Skeleton className="h-2.5 w-20" />
							<Skeleton className="h-3.5 w-28" />
						</div>
					))}
				</div>
			</section>
		</div>
	);
}

function presentServerStatus(
	status: LocalInferenceStatus | undefined,
	pendingAction: "starting" | "stopping" | "retrying" | undefined,
	queryPending: boolean,
	queryError: boolean,
): ServerStatusPresentation {
	if (queryPending) {
		return {
			label: "Loading…",
			indicatorClass: "bg-muted-foreground/50 animate-pulse",
			checked: false,
		};
	}
	if (queryError || status === undefined) {
		return { label: "Unavailable", indicatorClass: "bg-destructive", checked: false };
	}
	if (status.status === "preparing-runtime") {
		return {
			label: "Installing llama.cpp…",
			indicatorClass: "bg-amber-500 animate-pulse",
			checked: true,
		};
	}
	if (pendingAction === "starting" || pendingAction === "retrying") {
		return { label: "Starting…", indicatorClass: "bg-amber-500 animate-pulse", checked: true };
	}
	if (pendingAction === "stopping") {
		return { label: "Stopping…", indicatorClass: "bg-amber-500 animate-pulse", checked: true };
	}

	switch (status.status) {
		case "idle":
			return { label: "Idle", indicatorClass: "bg-muted-foreground/50", checked: true };
		case "starting":
			return { label: "Starting…", indicatorClass: "bg-amber-500 animate-pulse", checked: true };
		case "loading-model":
			return {
				label: "Loading model…",
				indicatorClass: "bg-amber-500 animate-pulse",
				checked: true,
			};
		case "ready":
			return { label: "Running", indicatorClass: "bg-emerald-500", checked: true };
		case "error":
			return { label: "Error", indicatorClass: "bg-destructive", checked: true };
		case "stopping":
			return { label: "Stopping…", indicatorClass: "bg-amber-500 animate-pulse", checked: true };
		case "disconnected":
			return { label: "Stopped", indicatorClass: "bg-muted-foreground/50", checked: false };
		default: {
			const exhaustive: never = status;
			return exhaustive;
		}
	}
}

function ModelCatalogDialogHeader() {
	return (
		<DialogHeader className="gap-0.5 px-4 pt-4 pr-3 pb-6 text-left">
			<DialogTitle className="text-base leading-tight">Local Model Catalog</DialogTitle>
			<DialogDescription className="text-sm leading-tight">
				Browse models from Anaconda and add them to your local model server.
			</DialogDescription>
		</DialogHeader>
	);
}

function ModelCatalogSignInGate({ reason }: { reason: string | undefined }) {
	const sdk = useSdk<LocalInferenceServiceContract>("local-inference");
	const [loginError, setLoginError] = useState<string>();
	const errorMessage = loginError ?? reason;

	const login = async (): Promise<void> => {
		setLoginError(undefined);
		try {
			const next = await sdk.auth.login();
			if (next.status === "error") {
				setLoginError(next.reason);
				return;
			}
			if (next.status === "authenticated") {
				void sdk.telemetry.track({ event: "LOGGED_IN" });
			}
		} catch (error) {
			setLoginError(error instanceof Error ? error.message : String(error));
		}
	};

	return (
		<Empty className="min-h-0" data-qa-id="model-catalog-sign-in">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<LogInIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>Sign in to browse models</EmptyTitle>
				<EmptyDescription>
					Sign in to your Anaconda account to view and download models from the catalog.
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button type="button" data-qa-id="model-catalog-login" onClick={() => void login()}>
					<LogInIcon data-icon="inline-start" aria-hidden="true" />
					Sign in with Anaconda
				</Button>
				{errorMessage ? (
					<p className="text-destructive text-sm" role="alert">
						{errorMessage}
					</p>
				) : null}
			</EmptyContent>
		</Empty>
	);
}

export function LocalModelServerSettings() {
	const sdk = useSdk<LocalInferenceServiceContract>("local-inference");
	const queryClient = useQueryClient();
	const authSession = useSyncExternalStore(sdk.auth.subscribe, sdk.auth.peek, sdk.auth.peek);
	const canBrowseCatalog = authSession.status === "authenticated";
	const modelFileInput = useRef<HTMLInputElement>(null);
	const modelSaveQueue = useRef(Promise.resolve());
	const [catalogOpen, setCatalogOpen] = useState(false);
	const [catalogModel, setCatalogModel] = useState<ModelCatalogEntry>();
	const [selectedModelId, setSelectedModelId] = useState<string>();
	const [modelSearch, setModelSearch] = useState("");
	const [modelSourceFilter, setModelSourceFilter] = useState<ModelSourceFilter>("all");
	const [modelFileError, setModelFileError] = useState<string>();
	const [modelPendingDeletion, setModelPendingDeletion] = useState<LocalModel>();
	const models = useSdkQuery(sdk, "models.list");
	const hasCatalogModels = Boolean(models.data?.some((model) => model.catalog));
	const status = useSdkQuery(sdk, "status.get");
	const usage = useQuery({
		...sdkQueryOptions(sdk, "usage.get"),
		refetchInterval: 1_000,
		refetchIntervalInBackground: false,
	});
	const catalogHardware = useQuery({
		...sdkQueryOptions(sdk, "hardware.profile"),
		enabled: canBrowseCatalog && catalogOpen,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const catalogMetadata = useQuery({
		...sdkQueryOptions(sdk, "catalog.list"),
		enabled: canBrowseCatalog && (hasCatalogModels || catalogOpen),
		retry: false,
		staleTime: 5 * 60 * 1_000,
	});
	const catalogDownloads = useSdkQuery(sdk, "catalog.downloads.list");
	const start = useSdkMutation(sdk, "runtime.connect", {
		invalidates: ["status.get"],
	});
	const stop = useSdkMutation(sdk, "runtime.disconnect", {
		invalidates: ["status.get"],
	});
	const retry = useSdkMutation(sdk, "runtime.retry", {
		invalidates: ["status.get"],
	});
	const serverSettings = useSdkQuery(sdk, "settings.get");
	const updateServerSettings = useSdkMutation(sdk, "settings.update", {
		invalidates: ["settings.get", "status.get"],
	});
	const addModel = useSdkMutation(sdk, "models.add", {
		invalidates: ["models.list", "status.get"],
	});
	const removeModel = useSdkMutation(sdk, "models.remove", {
		invalidates: ["models.list", "status.get"],
	});
	const updateModel = useSdkMutation(sdk, "models.update", {
		invalidates: ["models.list", "status.get"],
	});

	useEffect(() => {
		const stopStatus = sdk.events.on(`local-inference.${STATUS_CHANGED_EVENT}`, () => {
			void queryClient.invalidateQueries({ queryKey: sdkQueryKey(sdk, "status.get") });
		});
		const stopModels = sdk.events.on(`local-inference.${MODELS_CHANGED_EVENT}`, () => {
			void queryClient.invalidateQueries({ queryKey: sdkQueryKey(sdk, "models.list") });
		});
		const stopDownloads = sdk.events.on(
			`local-inference.${CATALOG_DOWNLOAD_CHANGED_EVENT}`,
			(payload) => {
				const parsed = modelDownloadSchema.safeParse(payload);
				if (!parsed.success) return;
				queryClient.setQueryData<ModelDownload[]>(
					sdkQueryKey(sdk, "catalog.downloads.list"),
					(current) => upsertDownload(current, parsed.data),
				);
				if (parsed.data.status === "completed") {
					void queryClient.invalidateQueries({ queryKey: sdkQueryKey(sdk, "models.list") });
					void queryClient.invalidateQueries({ queryKey: sdkQueryKey(sdk, "status.get") });
				}
			},
		);
		return () => {
			stopStatus();
			stopModels();
			stopDownloads();
		};
	}, [queryClient, sdk]);

	useEffect(() => {
		if (canBrowseCatalog) return;
		setCatalogModel(undefined);
		queryClient.removeQueries({ queryKey: sdkQueryKey(sdk, "catalog.list"), exact: true });
	}, [canBrowseCatalog, queryClient, sdk]);

	const serverStatus = status.data?.status;
	const pendingAction = start.isPending
		? ("starting" as const)
		: stop.isPending
			? ("stopping" as const)
			: retry.isPending
				? ("retrying" as const)
				: undefined;
	const statusPresentation = presentServerStatus(
		status.data,
		pendingAction,
		status.isPending,
		status.isError,
	);
	const transitionalStatus =
		serverStatus === "preparing-runtime" ||
		serverStatus === "starting" ||
		serverStatus === "stopping";
	const disabled =
		status.isPending || status.isError || pendingAction !== undefined || transitionalStatus;
	const statusError = status.data?.status === "error" ? status.data.message : status.error?.message;
	const connection = status.data?.status === "ready" ? status.data.connection : undefined;
	const modelRows = models.data ?? [];
	const modelManagementPending =
		models.isPending || (canBrowseCatalog && hasCatalogModels && catalogMetadata.isPending);
	const visibleModelRows = filterLocalModels(modelRows, modelSearch, modelSourceFilter);
	const activeModelSourceFilter =
		modelSourceFilters.find((filter) => filter.value === modelSourceFilter) ??
		modelSourceFilters[0];
	const catalogModels = new Map(
		catalogMetadata.data?.models.map((model) => [model.id, model] as const) ?? [],
	);
	const catalogDownloadRows = catalogDownloads.data ?? [];
	const addedCatalogArtifacts = new Map(
		modelRows.flatMap((model) =>
			model.catalog ? [[catalogArtifactKey(model.catalog), model] as const] : [],
		),
	);
	const updateDownload = (download: ModelDownload) => {
		queryClient.setQueryData<ModelDownload[]>(
			sdkQueryKey(sdk, "catalog.downloads.list"),
			(current) => upsertDownload(current, download),
		);
		return download;
	};
	const startCatalogDownload = (identity: DownloadIdentity) =>
		sdk.client["catalog.download.start"](identity).then(updateDownload);
	const cancelCatalogDownload = (identity: DownloadIdentity) =>
		sdk.client["catalog.download.cancel"](identity).then(updateDownload);
	const selectedModel =
		visibleModelRows.find((model) => model.id === selectedModelId) ?? visibleModelRows[0];
	const selectFirstVisibleModel = (
		search: string,
		source: ModelSourceFilter,
		currentModelId: string | undefined,
	) => {
		const nextModels = filterLocalModels(modelRows, search, source);
		return currentModelId && nextModels.some((model) => model.id === currentModelId)
			? currentModelId
			: nextModels[0]?.id;
	};
	const updateModelSearch = (search: string) => {
		setModelSearch(search);
		setSelectedModelId((current) => selectFirstVisibleModel(search, modelSourceFilter, current));
	};
	const updateModelSourceFilter = (source: ModelSourceFilter) => {
		setModelSourceFilter(source);
		setSelectedModelId((current) => selectFirstVisibleModel(modelSearch, source, current));
	};
	const clearModelFilters = () => {
		setModelSearch("");
		setModelSourceFilter("all");
		setSelectedModelId(modelRows[0]?.id);
	};
	const loadedModelIds = new Set(
		status.data?.status === "ready" || status.data?.status === "loading-model"
			? status.data.loadedModelIds
			: [],
	);
	if (status.data?.status === "ready" && status.data.loadedModelId) {
		loadedModelIds.add(status.data.loadedModelId);
	}
	const copyConnectionDetail = (value: string) => {
		void sdk.shell.copyText(value);
	};
	const requestModelDeletion = (model: LocalModel) => {
		removeModel.reset();
		setModelPendingDeletion(model);
	};
	const deleteModel = () => {
		if (!modelPendingDeletion) return;
		removeModel.mutate(
			{ id: modelPendingDeletion.id, mode: "delete-managed-file" },
			{ onSuccess: () => setModelPendingDeletion(undefined) },
		);
	};
	const importModel = (file: File | undefined) => {
		if (!file || addModel.isPending) return;
		if (!file.name.toLowerCase().endsWith(".gguf")) {
			setModelFileError("Only GGUF model files can be added.");
			return;
		}
		const path = sdk.shell.getPathForFile(file);
		if (!path) {
			setModelFileError("The selected file could not be resolved.");
			return;
		}
		setModelFileError(undefined);
		addModel.reset();
		addModel.mutate({ path });
	};
	const addModelError = modelFileError ?? addModel.error?.message;
	const saveModelSettings = (id: string, settings: LocalModelSettings) => {
		const save = modelSaveQueue.current.then(() =>
			updateModel.mutateAsync({ id, settings }).then(() => undefined),
		);
		modelSaveQueue.current = save.catch(() => undefined);
	};

	return (
		<div
			className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-8"
			data-qa-id="local-model-server-page"
		>
			<header className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h1
						className="text-lg font-semibold tracking-tight"
						data-qa-id="settings-section-heading"
					>
						Local Model Server
					</h1>
				</div>
				<div className="flex items-center gap-3">
					<div className="flex h-7 items-center gap-2">
						<span className="text-muted-foreground flex items-center gap-1.5 text-[13px]">
							<span
								className={cn("size-1.5 rounded-full", statusPresentation.indicatorClass)}
								aria-hidden
							/>
							{statusPresentation.label}
						</span>
						<Switch
							id="local-model-server-toggle"
							aria-label="Model server"
							checked={statusPresentation.checked}
							disabled={disabled}
							onCheckedChange={(checked) => {
								if (checked) start.mutate();
								else stop.mutate();
							}}
							data-qa-id="local-model-server-toggle"
						/>
					</div>
				</div>
			</header>
			{statusError ? (
				<div
					className="border-destructive/30 bg-destructive/5 text-destructive flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm"
					role="alert"
					data-qa-id="local-model-server-error"
				>
					<span>{statusError}</span>
					<Button
						type="button"
						variant="outline"
						size="sm"
						disabled={retry.isPending || status.isFetching}
						data-qa-id="local-model-server-retry"
						onClick={() => {
							if (status.data?.status === "error") retry.mutate();
							else void status.refetch();
						}}
					>
						{retry.isPending ? "Retrying…" : "Retry"}
					</Button>
				</div>
			) : null}
			<div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
				<SystemMonitor usage={usage.data} loading={usage.isPending} />
				<ConnectionDetails
					connection={connection}
					modelId={selectedModel?.id}
					onCopy={copyConnectionDetail}
				/>
			</div>
			<section className="mt-1 flex min-w-0 flex-col gap-4" aria-labelledby="models-heading">
				<div className="flex items-center justify-between gap-4">
					<div className="min-w-0">
						<h2 id="models-heading" className="text-sm font-medium">
							Models
						</h2>
						<p className="text-muted-foreground mt-1 text-sm">
							Manage local models and configure how each one runs.
						</p>
					</div>
					<input
						ref={modelFileInput}
						type="file"
						accept=".gguf"
						className="hidden"
						data-qa-id="local-model-server-file"
						onChange={(event) => {
							importModel(event.target.files?.[0]);
							event.target.value = "";
						}}
					/>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									type="button"
									size="sm"
									disabled={addModel.isPending}
									data-qa-id="local-model-server-add-model"
								/>
							}
						>
							<PlusIcon data-icon="inline-start" aria-hidden="true" />
							Add model
							<ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="min-w-44">
							<DropdownMenuGroup>
								<DropdownMenuItem
									data-qa-id="local-model-server-open-catalog"
									onClick={() => {
										setCatalogModel(undefined);
										setCatalogOpen(true);
									}}
								>
									<LibraryIcon aria-hidden="true" />
									From catalog
								</DropdownMenuItem>
								<DropdownMenuItem
									data-qa-id="local-model-server-import-gguf"
									onClick={() => {
										setModelFileError(undefined);
										addModel.reset();
										modelFileInput.current?.click();
									}}
								>
									<FileUpIcon aria-hidden="true" />
									Import GGUF
								</DropdownMenuItem>
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				{addModelError ? (
					<Field data-invalid>
						<FieldError>{addModelError}</FieldError>
					</Field>
				) : null}
				<div
					className={cn(
						"bg-card grid min-w-0 gap-3 rounded-xl border p-2",
						modelRows.length === 0 && !modelManagementPending
							? "md:grid-cols-1"
							: "md:grid-cols-[18rem_minmax(0,1fr)]",
					)}
				>
					<div className="min-w-0" data-qa-id="local-model-sidebar">
						{modelManagementPending ? (
							<ModelListSkeleton />
						) : modelRows.length === 0 ? (
							<NoModelsEmptyState failed={models.isError} />
						) : (
							<>
								<div
									className="flex items-center gap-1 pb-2"
									data-qa-id="local-model-list-controls"
								>
									<div className="relative min-w-0 flex-1">
										<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
										<Input
											type="search"
											aria-label="Search models"
											placeholder="Search models"
											className="h-7 pl-7 text-xs"
											value={modelSearch}
											data-qa-id="local-model-search"
											onChange={(event) => updateModelSearch(event.currentTarget.value)}
										/>
									</div>
									<DropdownMenu>
										<DropdownMenuTrigger
											render={
												<Button
													type="button"
													variant="ghost"
													size="icon-sm"
													aria-label={`Filter models: ${activeModelSourceFilter.label}`}
													className={cn(
														"text-muted-foreground shrink-0",
														modelSourceFilter !== "all" && "bg-foreground/5 text-foreground",
													)}
													data-qa-id="local-model-source-filter"
												/>
											}
										>
											<ListFilterIcon aria-hidden="true" />
										</DropdownMenuTrigger>
										<DropdownMenuContent align="end" className="min-w-44">
											<DropdownMenuGroup>
												<DropdownMenuLabel>Model source</DropdownMenuLabel>
												<DropdownMenuRadioGroup value={modelSourceFilter}>
													{modelSourceFilters.map((filter) => (
														<DropdownMenuRadioItem
															key={filter.value}
															value={filter.value}
															closeOnClick
															onClick={() => updateModelSourceFilter(filter.value)}
														>
															{filter.label}
														</DropdownMenuRadioItem>
													))}
												</DropdownMenuRadioGroup>
											</DropdownMenuGroup>
										</DropdownMenuContent>
									</DropdownMenu>
								</div>
								{visibleModelRows.length > 0 ? (
									<ModelSidebar
										models={visibleModelRows}
										catalogModels={catalogModels}
										loadedModelIds={loadedModelIds}
										selectedModelId={selectedModel?.id}
										removing={removeModel.isPending}
										onSelect={setSelectedModelId}
										onRemove={(model) =>
											removeModel.mutate({ id: model.id, mode: "registry-only" })
										}
										onReveal={(model) => {
											void sdk.shell.showItemInFolder(model.path).catch(() => undefined);
										}}
										onDelete={requestModelDeletion}
										onOpenCatalog={(model) => {
											setCatalogModel(model);
											setCatalogOpen(true);
										}}
									/>
								) : null}
							</>
						)}
					</div>
					{modelRows.length > 0 || modelManagementPending ? (
						<section
							aria-label={
								modelManagementPending
									? "Loading model settings"
									: selectedModel
										? `${selectedModel.name} model settings`
										: "Model settings"
							}
							className="min-w-0"
							data-qa-id="local-model-settings-card"
							data-model-id={modelManagementPending ? undefined : selectedModel?.id}
						>
							{modelManagementPending ? (
								<ModelSettingsSkeleton />
							) : selectedModel ? (
								<ModelSettingsPanel
									key={selectedModel.id}
									model={selectedModel}
									error={updateModel.error?.message}
									onSave={(settings) => saveModelSettings(selectedModel.id, settings)}
								/>
							) : (
								<NoMatchingModelsState onClear={clearModelFilters} />
							)}
						</section>
					) : null}
				</div>
			</section>
			<section className="mt-1 flex min-w-0 flex-col gap-4" aria-labelledby="runtime-heading">
				<div className="min-w-0">
					<h2 id="runtime-heading" className="text-sm font-medium">
						Runtime
					</h2>
					<p className="text-muted-foreground mt-1 text-sm">
						Configure how the server runs, loads models, and accepts connections.
					</p>
				</div>
				<div className="bg-card min-w-0 rounded-xl border p-4">
					{serverSettings.isPending ? (
						<div className="flex min-w-0 flex-col gap-5" aria-label="Loading server settings">
							<Skeleton className="h-14 w-full" />
							<Skeleton className="h-14 w-full" />
							<Skeleton className="h-14 w-full" />
						</div>
					) : (
						<ServerSettings
							settings={serverSettings.data ?? {}}
							disabled={serverSettings.isError}
							error={updateServerSettings.error?.message}
							onSave={async (settings) => {
								await updateServerSettings.mutateAsync(settings);
							}}
						/>
					)}
				</div>
			</section>
			<Dialog
				open={catalogOpen}
				onOpenChange={(open) => {
					setCatalogOpen(open);
					if (!open) setCatalogModel(undefined);
				}}
			>
				<DialogContent
					className="h-[min(48rem,calc(100dvh-8rem))] grid-rows-[minmax(0,1fr)] overflow-hidden sm:max-w-[calc(100vw-4rem)]"
					data-qa-id="local-model-catalog-dialog"
				>
					<div
						className={cn(
							"-m-4 grid min-h-0",
							canBrowseCatalog && "grid-cols-[minmax(0,3fr)_auto_minmax(22rem,2fr)]",
						)}
					>
						<div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
							<ModelCatalogDialogHeader />
							{canBrowseCatalog ? (
								<ScrollArea
									className={cn(
										"min-h-0 min-w-0 [&_[data-slot=scroll-area-viewport]]:scroll-fade-y [&_[data-slot=scroll-area-viewport]]:overflow-x-hidden",
										interactiveScrollbarClassName,
									)}
									data-qa-id="model-catalog-pane"
								>
									<div className="w-full min-w-0 overflow-x-hidden px-4 pr-3 pb-4">
										<LocalModelCatalog
											onSelectModel={setCatalogModel}
											selectedModelId={catalogModel?.id}
										/>
									</div>
								</ScrollArea>
							) : (
								<ModelCatalogSignInGate
									reason={authSession.status === "error" ? authSession.reason : undefined}
								/>
							)}
						</div>
						{canBrowseCatalog ? (
							<>
								<Separator orientation="vertical" />
								<section className="bg-background/60 min-h-0 min-w-0" aria-label="Model details">
									{catalogModel ? (
										<ModelDetailPane
											model={catalogModel}
											hardware={catalogHardware.data}
											downloads={catalogDownloadRows}
											addedCatalogArtifacts={addedCatalogArtifacts}
											onStartDownload={startCatalogDownload}
											onCancelDownload={cancelCatalogDownload}
											onDeleteModel={requestModelDeletion}
										/>
									) : catalogMetadata.isPending || catalogHardware.isPending ? (
										<ModelDetailSkeleton />
									) : (
										<ModelDetailEmpty />
									)}
								</section>
							</>
						) : null}
					</div>
				</DialogContent>
			</Dialog>
			<AlertDialog
				open={modelPendingDeletion !== undefined}
				onOpenChange={(open) => {
					if (!open && !removeModel.isPending) setModelPendingDeletion(undefined);
				}}
			>
				<AlertDialogContent data-qa-id="local-model-delete-dialog">
					<AlertDialogHeader>
						<AlertDialogTitle>Delete downloaded model?</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently deletes {modelPendingDeletion?.name ?? "this model"}
							{modelPendingDeletion?.sizeBytes
								? ` (${formatFileSize(modelPendingDeletion.sizeBytes)})`
								: ""}{" "}
							from this computer. You can download it again later.
						</AlertDialogDescription>
						{removeModel.error ? <FieldError>{removeModel.error.message}</FieldError> : null}
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={removeModel.isPending}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							variant="destructive"
							disabled={removeModel.isPending}
							data-qa-id="local-model-delete-confirm"
							onClick={deleteModel}
						>
							{removeModel.isPending ? "Deleting…" : "Delete file"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
