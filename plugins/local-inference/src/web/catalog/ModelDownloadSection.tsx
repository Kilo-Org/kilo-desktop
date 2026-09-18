import {
	CheckIcon,
	LoaderCircleIcon,
	PlusIcon,
	RotateCcwIcon,
	Trash2Icon,
	XIcon,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Badge } from "@kilo-desktop/ui/components/badge";
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
} from "@kilo-desktop/ui/components/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";

import type {
	LocalInferenceHardwareProfile,
	LocalModel,
	ModelCatalogEntry,
	ModelDownload,
} from "../../contracts/schemas.js";
import { evaluateCatalogModel } from "../../shared/catalog/model-compatibility.js";
import { catalogArtifactKey, type DownloadIdentity } from "./catalog-downloads.js";
import { ModelPerformance } from "./ModelPerformance.js";
import { formatFileSize } from "../models/model-format.js";

export function ModelDownloadSection({
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
			<div className="flex items-center justify-between gap-3 pr-px">
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
