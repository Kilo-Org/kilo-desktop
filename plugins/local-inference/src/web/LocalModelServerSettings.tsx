import { PlusIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
	sdkQueryKey,
	sdkQueryOptions,
	useSdk,
	useSdkMutation,
	useSdkQuery,
} from "@anaconda-agentic-desktop/sdk-react";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { Field, FieldError } from "@anaconda-agentic-desktop/ui/components/field";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { Switch } from "@anaconda-agentic-desktop/ui/components/switch";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type {
	LocalInferenceServiceContract,
	LocalInferenceStatus,
	LocalModelSettings,
} from "../contracts/schemas.js";
import { STATUS_CHANGED_EVENT } from "../shared/constants.js";
import { ConnectionDetails } from "./ConnectionDetails.js";
import { ModelSettingsPanel } from "./ModelSettingsPanel.js";
import { ModelSidebar } from "./ModelSidebar.js";
import { ServerSettings } from "./ServerSettings.js";
import { SystemMonitor } from "./SystemMonitor.js";

type ServerStatusPresentation = {
	label: string;
	indicatorClass: string;
	checked: boolean;
};

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
	if (pendingAction === "starting" || pendingAction === "retrying") {
		return { label: "Starting…", indicatorClass: "bg-amber-500 animate-pulse", checked: true };
	}
	if (pendingAction === "stopping") {
		return { label: "Stopping…", indicatorClass: "bg-amber-500 animate-pulse", checked: true };
	}

	switch (status.status) {
		case "idle":
			return { label: "Idle", indicatorClass: "bg-muted-foreground/50", checked: true };
		case "preparing-runtime":
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

export function LocalModelServerSettings() {
	const sdk = useSdk<LocalInferenceServiceContract>("local-inference");
	const queryClient = useQueryClient();
	const modelFileInput = useRef<HTMLInputElement>(null);
	const modelSaveQueue = useRef(Promise.resolve());
	const [selectedModelId, setSelectedModelId] = useState<string>();
	const [modelFileError, setModelFileError] = useState<string>();
	const models = useSdkQuery(sdk, "models.list");
	const status = useSdkQuery(sdk, "status.get");
	const usage = useQuery({
		...sdkQueryOptions(sdk, "usage.get"),
		refetchInterval: 1_000,
		refetchIntervalInBackground: false,
	});
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
		return sdk.events.on(`local-inference.${STATUS_CHANGED_EVENT}`, () => {
			void queryClient.invalidateQueries({ queryKey: sdkQueryKey(sdk, "status.get") });
		});
	}, [queryClient, sdk]);

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
	const selectedModel = modelRows.find((model) => model.id === selectedModelId) ?? modelRows[0];
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
					<Button
						type="button"
						size="sm"
						disabled={addModel.isPending}
						data-qa-id="local-model-server-add-model"
						onClick={() => {
							setModelFileError(undefined);
							addModel.reset();
							modelFileInput.current?.click();
						}}
					>
						<PlusIcon data-icon="inline-start" aria-hidden="true" />
						Add model
					</Button>
				</div>
				{addModelError ? (
					<Field data-invalid>
						<FieldError>{addModelError}</FieldError>
					</Field>
				) : null}
				<div className="bg-card grid min-w-0 gap-3 rounded-xl border p-2 md:grid-cols-[18rem_minmax(0,1fr)]">
					<div className="min-w-0" data-qa-id="local-model-sidebar">
						{models.isPending ? (
							<div className="flex flex-col gap-2 px-2 py-1" aria-label="Loading models">
								<Skeleton className="h-6 w-full" />
								<Skeleton className="h-6 w-4/5" />
							</div>
						) : modelRows.length === 0 ? (
							<p className="text-muted-foreground px-2 py-1 text-sm">
								{models.isError ? "Models could not be loaded." : "No models added."}
							</p>
						) : (
							<ModelSidebar
								models={modelRows}
								loadedModelIds={loadedModelIds}
								selectedModelId={selectedModel?.id}
								removing={removeModel.isPending}
								onSelect={setSelectedModelId}
								onEject={(modelId) => removeModel.mutate({ id: modelId })}
							/>
						)}
					</div>
					<section
						aria-label={selectedModel ? `${selectedModel.name} model settings` : "Model settings"}
						className="min-w-0"
						data-qa-id="local-model-settings-card"
						data-model-id={selectedModel?.id}
					>
						{selectedModel ? (
							<ModelSettingsPanel
								key={selectedModel.id}
								model={selectedModel}
								error={updateModel.error?.message}
								onSave={(settings) => saveModelSettings(selectedModel.id, settings)}
							/>
						) : null}
					</section>
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
		</div>
	);
}
