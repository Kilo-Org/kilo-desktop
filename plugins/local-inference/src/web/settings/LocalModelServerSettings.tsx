import {
	ChevronDownIcon,
	FileUpIcon,
	LibraryIcon,
	ListFilterIcon,
	PlusIcon,
	SearchIcon,
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
import { Dialog, DialogContent } from "@anaconda-agentic-desktop/ui/components/dialog";
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
import { Field, FieldError } from "@anaconda-agentic-desktop/ui/components/field";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import { ScrollArea } from "@anaconda-agentic-desktop/ui/components/scroll-area";
import { Separator } from "@anaconda-agentic-desktop/ui/components/separator";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { Switch } from "@anaconda-agentic-desktop/ui/components/switch";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type {
	LocalInferenceServiceContract,
	ModelDownload,
	LocalModel,
	LocalModelSettings,
	ModelCatalogEntry,
} from "../../contracts/schemas.js";
import { modelDownloadSchema } from "../../contracts/schemas.js";
import {
	CATALOG_DOWNLOAD_CHANGED_EVENT,
	MODELS_CHANGED_EVENT,
	STATUS_CHANGED_EVENT,
} from "../../contracts/events.js";
import { ConnectionDetails } from "../connections/ConnectionDetails.js";
import { LocalModelCatalog } from "../catalog/ModelCatalog.js";
import { ModelCatalogDialogHeader, ModelCatalogSignInGate } from "../catalog/ModelCatalogAccess.js";
import {
	ModelDetailEmpty,
	ModelDetailPane,
	ModelDetailSkeleton,
} from "../catalog/ModelDetailPane.js";
import {
	catalogArtifactKey,
	type DownloadIdentity,
	upsertDownload,
} from "../catalog/catalog-downloads.js";
import { ModelSettingsPanel } from "../models/ModelSettingsPanel.js";
import { ModelSidebar } from "../models/ModelSidebar.js";
import {
	ModelListSkeleton,
	ModelSettingsSkeleton,
	NoMatchingModelsState,
	NoModelsEmptyState,
} from "../models/ModelManagementStates.js";
import {
	filterLocalModels,
	modelSourceFilters,
	type ModelSourceFilter,
} from "../models/model-filter.js";
import { formatFileSize } from "../models/model-format.js";
import { ServerSettings } from "../server/ServerSettings.js";
import { SystemMonitor } from "../server/SystemMonitor.js";
import { presentServerStatus } from "../server/server-status-presentation.js";

const interactiveScrollbarClassName =
	"[&_[data-slot=scroll-area-scrollbar]]:opacity-0 hover:[&_[data-slot=scroll-area-scrollbar]]:opacity-100 focus-within:[&_[data-slot=scroll-area-scrollbar]]:opacity-100";

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
						className="text-base font-semibold tracking-tight"
						data-qa-id="settings-section-heading"
					>
						Local Model Server
					</h1>
				</div>
				<div className="flex items-center gap-3">
					<div className="flex h-7 items-center gap-2">
						<span className="text-muted-foreground flex items-center gap-1.5 text-sm">
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
						<h2 id="models-heading" className="text-sm leading-tight font-medium">
							Models
						</h2>
						<p className="text-muted-foreground mt-0.5 text-sm leading-snug">
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
					<h2 id="runtime-heading" className="text-sm leading-tight font-medium">
						Runtime
					</h2>
					<p className="text-muted-foreground mt-0.5 text-sm leading-snug">
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
					className="h-[min(48rem,calc(100dvh-8rem))] grid-rows-[minmax(0,1fr)] overflow-hidden sm:w-[calc(100%-4rem)] sm:max-w-7xl"
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
