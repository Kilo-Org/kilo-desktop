import {
	ChevronDownIcon,
	CircleAlertIcon,
	FileUpIcon,
	LibraryIcon,
	ListFilterIcon,
	PlusIcon,
	RefreshCwIcon,
	SearchIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
	sdkQueryKey,
	sdkQueryOptions,
	SettingsPageHeader,
	useAnacondaSignIn,
	useSdk,
	useSdkMutation,
	useSdkQuery,
} from "@kilo-desktop/sdk-react";
import { AnacondaSignInDialog } from "@kilo-desktop/ui/components/anaconda-sign-in-dialog";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Alert, AlertAction, AlertTitle } from "@kilo-desktop/ui/components/alert";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kilo-desktop/ui/components/alert-dialog";
import { Dialog, DialogContent } from "@kilo-desktop/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldLegend,
	FieldSet,
} from "@kilo-desktop/ui/components/field";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@kilo-desktop/ui/components/input-group";
import { ScrollArea } from "@kilo-desktop/ui/components/scroll-area";
import { Separator } from "@kilo-desktop/ui/components/separator";
import { Switch } from "@kilo-desktop/ui/components/switch";
import { cn } from "@kilo-desktop/ui/lib/utils";

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
import { ModelCatalogDialogHeader } from "../catalog/ModelCatalogAccess.js";
import { ModelDetailPane, ModelDetailSkeleton } from "../catalog/ModelDetailPane.js";
import {
	catalogArtifactKey,
	type DownloadIdentity,
	upsertDownload,
} from "../catalog/catalog-downloads.js";
import { ModelSettingsPanel } from "../models/ModelSettingsPanel.js";
import { ModelList } from "../models/ModelList.js";
import {
	ModelListSkeleton,
	NoMatchingModelsState,
	NoModelsEmptyState,
} from "../models/ModelManagementStates.js";
import {
	filterLocalModels,
	modelSourceFilters,
	type ModelSourceFilter,
} from "../models/model-filter.js";
import { formatFileSize, modelDisplayName } from "../models/model-format.js";
import { ServerSettings, ServerSettingsSkeleton } from "../server/ServerSettings.js";
import { SystemMonitor } from "../server/SystemMonitor.js";
import { presentServerStatus } from "../server/server-status-presentation.js";

const interactiveScrollbarClassName =
	"[&_[data-slot=scroll-area-scrollbar]]:opacity-0 hover:[&_[data-slot=scroll-area-scrollbar]]:opacity-100 focus-within:[&_[data-slot=scroll-area-scrollbar]]:opacity-100";

function useCatalogModelId(sdk: ReturnType<typeof useSdk<LocalInferenceServiceContract>>) {
	const subscribe = useCallback((fn: () => void) => sdk.location.subscribe(fn), [sdk]);
	const getSnapshot = useCallback(() => {
		const catalogModel = sdk.location.peek().search.catalogModel;
		if (catalogModel == null || catalogModel === "") return undefined;
		return String(catalogModel);
	}, [sdk]);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function LocalModelServerSettings() {
	const sdk = useSdk<LocalInferenceServiceContract>("local-inference");
	const queryClient = useQueryClient();
	const { authenticated, signingIn, error: signInError, signIn } = useAnacondaSignIn(sdk);
	const modelFileInput = useRef<HTMLInputElement>(null);
	const modelSaveQueue = useRef(Promise.resolve());
	const [catalogOpen, setCatalogOpen] = useState(false);
	const [catalogModel, setCatalogModel] = useState<ModelCatalogEntry>();
	const catalogModelId = useCatalogModelId(sdk);
	const [appliedCatalogModelId, setAppliedCatalogModelId] = useState<string>();
	const [pendingCatalogModel, setPendingCatalogModel] = useState<ModelCatalogEntry | null>();
	const [signInOpen, setSignInOpen] = useState(false);
	const [expandedModelIds, setExpandedModelIds] = useState<ReadonlySet<string>>(() => new Set());
	const [lastExpandedModelId, setLastExpandedModelId] = useState<string>();
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
		enabled: authenticated && catalogOpen,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const catalogMetadata = useQuery({
		...sdkQueryOptions(sdk, "catalog.list"),
		enabled: authenticated && (hasCatalogModels || catalogOpen),
		retry: false,
		staleTime: 5 * 60 * 1_000,
	});
	// `sdk.auth.peek()` reads anonymous until the shell's first resolve lands,
	// so "anonymous" alone cannot tell a signed-out user from a pending check.
	// Settling getSession() gives that signal without widening the auth API.
	const authResolution = useQuery({
		queryKey: ["local-inference", "auth-session-resolved"],
		queryFn: () => sdk.auth.getSession(),
		enabled: !authenticated,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
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

	// Losing the session mid-browse must not leave stale catalog data on
	// screen: close the dialog, drop the selection, and purge the cached
	// catalog so a later sign-in starts from a fresh fetch.
	useEffect(() => {
		if (authenticated) return;
		setCatalogOpen(false);
		setCatalogModel(undefined);
		setPendingCatalogModel(undefined);
		queryClient.removeQueries({ queryKey: sdkQueryKey(sdk, "catalog.list"), exact: true });
	}, [authenticated, queryClient, sdk]);

	function openCatalog(model?: ModelCatalogEntry): void {
		if (!authenticated) {
			setPendingCatalogModel(model ?? null);
			setSignInOpen(true);
			return;
		}
		setCatalogModel(model);
		setCatalogOpen(true);
	}

	async function handleSignIn(): Promise<void> {
		const ok = await signIn();
		if (!ok) return;
		setSignInOpen(false);
		setCatalogModel(pendingCatalogModel ?? undefined);
		setPendingCatalogModel(undefined);
		setCatalogOpen(true);
	}

	useEffect(() => {
		if (!catalogModelId) return;
		if (!authenticated) {
			setPendingCatalogModel(null);
			setSignInOpen(true);
			return;
		}
		setSignInOpen(false);
		setCatalogOpen(true);
	}, [authenticated, catalogModelId]);

	// Apply a catalogModel deep link during render, in the same pass where
	// catalog metadata arrives: the details skeleton hands straight over to the
	// pane with no commit in between where the pane unmounts. Each link id is
	// applied once so the user can then browse to other models.
	if (appliedCatalogModelId !== catalogModelId) {
		if (!catalogModelId) {
			setAppliedCatalogModelId(undefined);
		} else if (authenticated && catalogMetadata.data) {
			setAppliedCatalogModelId(catalogModelId);
			setCatalogModel(catalogMetadata.data.models.find((model) => model.id === catalogModelId));
		}
	}

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
	// Catalog-backed rows wait for catalog metadata (publisher icon,
	// quantization) so they render once, complete. The skeleton only covers the
	// first load: once rows have rendered, a later auth change or catalog refetch
	// updates them in place instead of flashing back to the skeleton.
	const modelManagementLoading =
		models.isPending ||
		(hasCatalogModels && (authenticated ? catalogMetadata.isPending : authResolution.isPending));
	const [modelListRendered, setModelListRendered] = useState(false);
	if (!modelManagementLoading && !modelListRendered) setModelListRendered(true);
	const modelManagementPending = modelManagementLoading && !modelListRendered;
	const visibleModelRows = filterLocalModels(modelRows, modelSearch, modelSourceFilter);
	const activeModelSourceFilter =
		modelSourceFilters.find((filter) => filter.value === modelSourceFilter) ??
		modelSourceFilters[0];
	const catalogModels = new Map(
		catalogMetadata.data?.models.map((model) => [model.id, model] as const) ?? [],
	);
	const resolvingCatalogModelLink = catalogModelId !== undefined && catalogMetadata.isPending;
	const catalogDetailOpen = catalogModel !== undefined || resolvingCatalogModelLink;
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
	const connectionModel =
		visibleModelRows.find((model) => model.id === lastExpandedModelId) ?? visibleModelRows[0];
	const setModelExpanded = (modelId: string, open: boolean) => {
		setExpandedModelIds((current) => {
			const next = new Set(current);
			if (open) next.add(modelId);
			else next.delete(modelId);
			return next;
		});
		if (open) setLastExpandedModelId(modelId);
	};
	const clearModelFilters = () => {
		setModelSearch("");
		setModelSourceFilter("all");
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
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="local-model-server-page">
			<SettingsPageHeader
				actions={
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
				}
			/>
			<div className="flex min-w-0 flex-col gap-8">
				{statusError ? (
					<Alert variant="destructive" data-qa-id="local-model-server-error">
						<CircleAlertIcon aria-hidden="true" />
						<AlertTitle>{statusError}</AlertTitle>
						<AlertAction>
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
								<RefreshCwIcon
									data-icon="inline-start"
									className={retry.isPending ? "animate-spin" : undefined}
								/>
								Try again
							</Button>
						</AlertAction>
					</Alert>
				) : null}
				<div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
					<SystemMonitor usage={usage.data} loading={usage.isPending} />
					<ConnectionDetails
						connection={connection}
						modelId={connectionModel?.id}
						onCopy={copyConnectionDetail}
					/>
				</div>
				<FieldSet className="mt-1 min-w-0" aria-labelledby="models-heading">
					<div className="flex items-center justify-between gap-4">
						<FieldContent>
							<FieldLegend id="models-heading" variant="label" className="mb-0">
								Models
							</FieldLegend>
							<FieldDescription>
								Manage local models and configure how each one runs.
							</FieldDescription>
						</FieldContent>
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
											openCatalog();
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
					{modelManagementPending ? (
						<ModelListSkeleton />
					) : modelRows.length === 0 ? (
						<div className="border-border bg-card rounded-lg border">
							<NoModelsEmptyState failed={models.isError} />
						</div>
					) : (
						<div className="flex min-w-0 flex-col gap-3">
							<div className="flex items-center gap-2" data-qa-id="local-model-list-controls">
								<InputGroup size="sm" className="min-w-0 flex-1">
									<InputGroupInput
										type="search"
										aria-label="Search models"
										placeholder="Search models"
										value={modelSearch}
										data-qa-id="local-model-search"
										onChange={(event) => setModelSearch(event.currentTarget.value)}
									/>
									<InputGroupAddon>
										<SearchIcon aria-hidden="true" />
									</InputGroupAddon>
								</InputGroup>
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												type="button"
												variant={modelSourceFilter === "all" ? "outline" : "secondary"}
												size="icon-sm"
												aria-label={`Filter models: ${activeModelSourceFilter.label}`}
												className="shrink-0"
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
														onClick={() => setModelSourceFilter(filter.value)}
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
								<ModelList
									models={visibleModelRows}
									catalogModels={catalogModels}
									loadedModelIds={loadedModelIds}
									expandedModelIds={expandedModelIds}
									onExpandedChange={setModelExpanded}
									renderSettings={(model) => (
										<ModelSettingsPanel
											model={model}
											error={
												updateModel.variables?.id === model.id
													? updateModel.error?.message
													: undefined
											}
											onSave={(settings) => saveModelSettings(model.id, settings)}
										/>
									)}
									removing={removeModel.isPending}
									onRemove={(model) => removeModel.mutate({ id: model.id, mode: "registry-only" })}
									onReveal={(model) => {
										void sdk.shell.showItemInFolder(model.path).catch(() => undefined);
									}}
									onDelete={requestModelDeletion}
									onOpenCatalog={(model) => {
										openCatalog(model);
									}}
								/>
							) : (
								<NoMatchingModelsState onClear={clearModelFilters} />
							)}
						</div>
					)}
				</FieldSet>
				<FieldSet className="min-w-0" aria-labelledby="runtime-heading">
					<FieldContent>
						<FieldLegend id="runtime-heading" variant="label" className="mb-0">
							Runtime
						</FieldLegend>
						<FieldDescription>
							Configure how the server runs, loads models, and accepts connections.
						</FieldDescription>
					</FieldContent>
					<div className="bg-card min-w-0 overflow-hidden rounded-lg border">
						{serverSettings.isPending ? (
							<ServerSettingsSkeleton />
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
				</FieldSet>
			</div>
			<Dialog
				open={catalogOpen}
				onOpenChange={(open) => {
					setCatalogOpen(open);
					if (!open) {
						setCatalogModel(undefined);
						const location = sdk.location.peek();
						if (typeof location.search.catalogModel === "string") {
							const { catalogModel: _ignored, ...search } = location.search;
							sdk.navigate(location.path, { search, replace: true });
						}
					}
				}}
			>
				<DialogContent
					className="h-[min(48rem,calc(100dvh-4rem))] grid-rows-[minmax(0,1fr)] overflow-hidden sm:w-[calc(100%-4rem)] sm:max-w-6xl"
					data-qa-id="local-model-catalog-dialog"
				>
					<div
						className={cn(
							"-m-4 grid min-h-0",
							catalogDetailOpen
								? "grid-cols-[minmax(0,3fr)_auto_minmax(22rem,2fr)]"
								: "grid-cols-[minmax(0,1fr)]",
						)}
					>
						<div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
							<ModelCatalogDialogHeader />
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
						</div>
						{catalogDetailOpen ? (
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
									) : (
										<ModelDetailSkeleton />
									)}
								</section>
							</>
						) : null}
					</div>
				</DialogContent>
			</Dialog>
			<AnacondaSignInDialog
				open={signInOpen}
				onOpenChange={setSignInOpen}
				onSignIn={() => void handleSignIn()}
				pending={signingIn}
				error={signInError}
			/>
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
							This permanently deletes{" "}
							{modelPendingDeletion ? modelDisplayName(modelPendingDeletion) : "this model"}
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
							{removeModel.isPending ? (
								<Spinner data-icon="inline-start" aria-hidden="true" />
							) : null}
							{removeModel.isPending ? "Deleting…" : "Delete file"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
