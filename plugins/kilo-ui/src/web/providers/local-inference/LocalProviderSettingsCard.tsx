import { useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
	createLucideIcon,
	FilePlus2Icon,
	LoaderCircleIcon,
	PlayIcon,
	ServerIcon,
	SquareIcon,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { sdkQueryOptions, useSdk, useSdkMutation } from "@anaconda-agentic-desktop/sdk-react";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	Collapsible,
	CollapsibleContent,
} from "@anaconda-agentic-desktop/ui/components/collapsible";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { SummaryCard } from "@anaconda-agentic-desktop/ui/components/summary-card";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type { LocalInferenceServiceContract, LocalModel } from "./contract.js";
import { ConnectionInfoDialog } from "./ConnectionInfoDialog.js";
import { ModelSettingsDialog } from "./ModelSettingsDialog.js";
import { ServerSettingsDialog } from "./ServerSettingsDialog.js";
import { modelHeat, modelHeatLabel, type ModelHeat } from "./model-heat.js";
import { localProviderStatusText } from "./status-copy.js";

// lucide-react 1.27 does not export Eject yet; this is the upstream glyph.
const EjectIcon = createLucideIcon("eject", [
	[
		"path",
		{
			d: "M4 13a1 1 0 0 1-.72-1.695l7.257-7.668a2 2 0 0 1 2.926 0l7.256 7.668A1 1 0 0 1 20 13z",
			key: "triangle",
		},
	],
	["rect", { x: "3", y: "17", width: "18", height: "4", rx: "1", key: "bar" }],
]);

function HeatDot({ heat }: { heat: ModelHeat }) {
	if (heat === "loading") {
		return <LoaderCircleIcon className="text-muted-foreground size-3.5 animate-spin" aria-hidden />;
	}
	return (
		<span
			className={cn(
				"size-2 rounded-full",
				heat === "warm" ? "bg-primary" : "bg-muted-foreground/35",
			)}
			aria-hidden
		/>
	);
}

function HeatIndicator({ heat, modelId }: { heat: ModelHeat; modelId: string }) {
	const label = modelHeatLabel(heat);
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="size-4 shrink-0"
						aria-label={label}
						data-qa-id={`local-provider-heat-${modelId}`}
						data-heat={heat}
					/>
				}
			>
				<HeatDot heat={heat} />
			</TooltipTrigger>
			<TooltipContent data-qa-id="local-provider-heat-tooltip">{label}</TooltipContent>
		</Tooltip>
	);
}

function EjectButton({
	name,
	disabled,
	onEject,
}: {
	name: string;
	disabled: boolean;
	onEject: () => void;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={`Eject ${name}`}
						disabled={disabled}
						onClick={onEject}
					/>
				}
			>
				<EjectIcon />
			</TooltipTrigger>
			<TooltipContent data-qa-id="local-provider-eject-tooltip">
				Eject the model from the local server.
			</TooltipContent>
		</Tooltip>
	);
}

function StartButton({ disabled, onStart }: { disabled: boolean; onStart: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Start the local server"
						disabled={disabled}
						data-qa-id="local-provider-connect"
						onClick={(event) => {
							event.stopPropagation();
							onStart();
						}}
					/>
				}
			>
				<PlayIcon />
			</TooltipTrigger>
			<TooltipContent data-qa-id="local-provider-start-tooltip">
				Start the local server.
			</TooltipContent>
		</Tooltip>
	);
}

function StopButton({ disabled, onStop }: { disabled: boolean; onStop: () => void }) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label="Stop the local server"
						disabled={disabled}
						data-qa-id="local-provider-stop"
						onClick={(event) => {
							event.stopPropagation();
							onStop();
						}}
					/>
				}
			>
				<SquareIcon />
			</TooltipTrigger>
			<TooltipContent data-qa-id="local-provider-stop-tooltip">
				Stop the local server and all loaded models.
			</TooltipContent>
		</Tooltip>
	);
}

export function LocalProviderSettingsCard() {
	const sdk = useSdk<LocalInferenceServiceContract>("local-inference");
	const input = useRef<HTMLInputElement>(null);
	const [detailsOpen, setDetailsOpen] = useState(false);
	const [isDragging, setIsDragging] = useState(false);
	const [fileError, setFileError] = useState<string | null>(null);
	const models = useQuery(sdkQueryOptions(sdk, "models.list"));
	const status = useQuery({
		...sdkQueryOptions(sdk, "status.get"),
		refetchInterval: 1_000,
	});
	const add = useSdkMutation(sdk, "models.add", {
		invalidates: ["models.list", "status.get"],
	});
	const remove = useSdkMutation(sdk, "models.remove", {
		invalidates: ["models.list", "status.get"],
	});
	const update = useSdkMutation(sdk, "models.update", {
		invalidates: ["models.list", "status.get"],
	});
	const retry = useSdkMutation(sdk, "runtime.retry", {
		invalidates: ["status.get"],
	});
	const connect = useSdkMutation(sdk, "runtime.connect", {
		invalidates: ["status.get"],
	});
	const stop = useSdkMutation(sdk, "runtime.disconnect", {
		invalidates: ["status.get"],
	});
	const serverSettings = useQuery(sdkQueryOptions(sdk, "settings.get"));
	const updateServer = useSdkMutation(sdk, "settings.update", {
		invalidates: ["settings.get", "status.get"],
	});
	const rows = models.data ?? [];
	const loadingId = status.data?.status === "loading-model" ? status.data.modelId : undefined;
	const loadingModel = rows.find((model) => model.id === loadingId);
	const error =
		models.error ??
		status.error ??
		serverSettings.error ??
		add.error ??
		remove.error ??
		update.error ??
		updateServer.error ??
		retry.error ??
		connect.error ??
		stop.error;
	const errorMessage =
		fileError ?? (status.data?.status === "error" ? status.data.message : error?.message);
	const displayedStatus =
		stop.isPending && status.data?.status !== "disconnected"
			? { status: "stopping" as const }
			: status.data;
	const disconnected = displayedStatus?.status === "disconnected";
	const stopping = displayedStatus?.status === "stopping";
	const connection = displayedStatus?.status === "ready" ? displayedStatus.connection : undefined;
	const exampleModelId = rows.find((model) => model.available)?.id;
	const showConnect = disconnected;
	const showStop = !disconnected && rows.length > 0;
	const busy =
		displayedStatus?.status === "preparing-runtime" ||
		displayedStatus?.status === "starting" ||
		displayedStatus?.status === "loading-model" ||
		stopping;
	const detailsExpanded = Boolean(errorMessage) || detailsOpen;
	const summary =
		busy || displayedStatus?.status === "ready" || disconnected
			? localProviderStatusText(displayedStatus, {
					modelName: loadingModel?.name,
					modelCount: rows.length,
				})
			: modelAvailabilityText(rows, models.isPending);
	const addFile = (file: File | undefined) => {
		if (!file || add.isPending) return;
		if (!file.name.toLowerCase().endsWith(".gguf")) {
			setFileError("Only GGUF model files can be added.");
			return;
		}
		const path = sdk.shell.getPathForFile(file);
		if (!path) {
			setFileError("The selected file could not be resolved.");
			return;
		}
		setFileError(null);
		add.mutate({ path });
	};

	return (
		<TooltipProvider>
			<Collapsible
				className="min-w-0"
				open={detailsExpanded}
				onOpenChange={setDetailsOpen}
				data-qa-id="local-provider-card"
				data-state={detailsExpanded ? "expanded" : "summary"}
			>
				<SummaryCard.Row>
					<SummaryCard.Trigger
						type="button"
						aria-label="Manage local models"
						data-qa-id="local-provider-row-trigger"
					>
						<SummaryCard.Icon>
							<ServerIcon className="size-[18px]" aria-hidden />
						</SummaryCard.Icon>
						<SummaryCard.Content data-qa-id="local-provider-summary">
							<SummaryCard.Title>
								<h2>Local Model Server</h2>
							</SummaryCard.Title>
							<SummaryCard.Description className="flex min-w-0 items-center gap-1.5">
								{busy ? (
									<span className="animate-spin">
										<LoaderCircleIcon className="size-3" />
									</span>
								) : null}
								<span className="truncate">{summary}</span>
							</SummaryCard.Description>
						</SummaryCard.Content>
					</SummaryCard.Trigger>
					<SummaryCard.Actions>
						<div
							className={cn(
								"flex items-center justify-end gap-2",
								!detailsExpanded &&
									"pointer-events-none opacity-0 transition-opacity group-hover/summary-card:pointer-events-auto group-hover/summary-card:opacity-100 group-has-[:focus-visible]/summary-card:pointer-events-auto group-has-[:focus-visible]/summary-card:opacity-100",
							)}
							data-qa-id="local-provider-actions"
						>
							{showConnect ? (
								<StartButton disabled={connect.isPending} onStart={() => connect.mutate()} />
							) : null}
							{showStop ? (
								<StopButton disabled={stop.isPending || stopping} onStop={() => stop.mutate()} />
							) : null}
							{connection ? (
								<ConnectionInfoDialog
									connection={connection}
									modelId={exampleModelId}
									onCopy={(text) => {
										void sdk.shell.copyText(text);
									}}
								/>
							) : null}
							<ServerSettingsDialog
								settings={serverSettings.data ?? {}}
								pending={updateServer.isPending}
								error={updateServer.error?.message}
								onSave={async (next) => {
									await updateServer.mutateAsync(next);
								}}
							/>
						</div>
						<SummaryCard.Toggle
							label="Toggle local model details"
							open={detailsExpanded}
							data-qa-id="local-provider-toggle"
						/>
					</SummaryCard.Actions>
				</SummaryCard.Row>
				<input
					ref={input}
					type="file"
					accept=".gguf"
					className="hidden"
					data-qa-id="local-provider-file"
					onChange={(event) => {
						addFile(event.target.files?.[0]);
						event.target.value = "";
					}}
				/>
				<CollapsibleContent>
					<div className="border-border bg-background/60 border-t">
						{errorMessage ? (
							<div
								className="border-border text-destructive flex items-center justify-between gap-3 border-b px-3 py-3 text-sm"
								role="alert"
							>
								<span>{errorMessage}</span>
								{fileError ? null : (
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={retry.isPending}
										onClick={() => retry.mutate()}
										data-qa-id="local-provider-retry"
									>
										Retry
									</Button>
								)}
							</div>
						) : null}
						{models.isPending ? (
							<div className="p-3">
								<Skeleton className="h-32 w-full" />
							</div>
						) : (
							<div
								data-qa-id="local-provider-dropzone"
								onDragOver={(event) => {
									event.preventDefault();
									if (!add.isPending) setIsDragging(true);
								}}
								onDragLeave={(event) => {
									if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
										setIsDragging(false);
									}
								}}
								onDrop={(event: DragEvent) => {
									event.preventDefault();
									setIsDragging(false);
									addFile(event.dataTransfer.files[0]);
								}}
								className={cn("min-w-0 transition-colors", isDragging && "bg-primary/5")}
							>
								{rows.length === 0 ? (
									<div
										role="button"
										tabIndex={0}
										aria-label="Choose a GGUF model"
										onClick={() => input.current?.click()}
										onKeyDown={(event: KeyboardEvent) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												input.current?.click();
											}
										}}
										className="hover:bg-foreground/5 flex min-h-32 cursor-pointer flex-col items-center justify-center gap-2.5 text-center transition-colors"
										data-qa-id="local-provider-empty"
									>
										<div className="bg-foreground/10 text-muted-foreground flex size-9 items-center justify-center rounded-full">
											<FilePlus2Icon className="size-4" />
										</div>
										<div className="flex flex-col gap-0.5">
											<span className="text-sm font-medium">Drop a GGUF model here</span>
											<span className="text-muted-foreground text-xs">
												or click to choose a file
											</span>
										</div>
									</div>
								) : (
									<div className="divide-border divide-y">
										{rows.map((model) => {
											const heat = modelHeat(status.data, model.id);
											return (
												<div
													key={model.id}
													className="flex min-w-0 items-center gap-3 px-3 py-3"
													data-qa-id={`local-provider-model-${model.id}`}
												>
													<div className="min-w-0 flex-1">
														<div className="flex min-w-0 items-center gap-1.5">
															<p className="min-w-0 truncate text-sm font-medium">{model.name}</p>
															<HeatIndicator heat={heat} modelId={model.id} />
														</div>
														<p className="text-muted-foreground truncate text-xs">
															{model.available ? model.path : "File is unavailable"}
														</p>
													</div>
													<div className="flex shrink-0 items-center gap-2">
														<ModelSettingsDialog
															model={model}
															pending={update.isPending}
															error={update.error?.message}
															onSave={async (settings) => {
																await update.mutateAsync({ id: model.id, settings });
															}}
														/>
														<EjectButton
															name={model.name}
															disabled={remove.isPending}
															onEject={() => remove.mutate({ id: model.id })}
														/>
													</div>
												</div>
											);
										})}
										<button
											type="button"
											disabled={add.isPending}
											onClick={() => input.current?.click()}
											className="text-muted-foreground hover:bg-foreground/5 hover:text-foreground flex min-h-11 w-full items-center gap-2 px-3 py-3 text-left text-sm transition-colors disabled:pointer-events-none disabled:opacity-50"
											data-qa-id="local-provider-add"
										>
											<FilePlus2Icon className="size-4" />
											Add GGUF model
										</button>
									</div>
								)}
							</div>
						)}
					</div>
				</CollapsibleContent>
			</Collapsible>
		</TooltipProvider>
	);
}

function modelAvailabilityText(models: LocalModel[], pending: boolean): string {
	if (pending) return "Loading models…";
	if (models.length === 0) return "No models added";
	const available = models.filter((model) => model.available).length;
	if (available === models.length) {
		return `${available} ${available === 1 ? "model" : "models"} available`;
	}
	return `${available} of ${models.length} models available`;
}
