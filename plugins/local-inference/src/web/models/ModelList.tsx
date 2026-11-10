import {
	ArrowRightIcon,
	createLucideIcon,
	EllipsisIcon,
	FileIcon,
	FolderOpenIcon,
	LibraryIcon,
	Trash2Icon,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Collapsible, CollapsibleContent } from "@kilo-desktop/ui/components/collapsible";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import { revealInFileManagerLabel } from "@kilo-desktop/ui/lib/reveal-in-file-manager";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { LocalModel, ModelCatalogEntry } from "../../contracts/index";
import { getPublisherDisplayName, ModelPublisherIcon } from "../catalog/ModelPublisherIcon";
import { formatFileSize, formatParameterCount, modelDisplayName } from "./model-format";

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

type ModelListActions = {
	removing: boolean;
	onRemove: (model: LocalModel) => void;
	onReveal: (model: LocalModel) => void;
	onDelete: (model: LocalModel) => void;
	onOpenCatalog: (model: ModelCatalogEntry) => void;
};

type ModelCardProps = ModelListActions & {
	model: LocalModel;
	catalogModel: ModelCatalogEntry | undefined;
	loaded: boolean;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	settings: ReactNode;
};

function ModelStatusDot({ modelId, loaded }: { modelId: string; loaded: boolean }) {
	return (
		<span
			className={cn(
				"size-2 shrink-0 rounded-full",
				loaded ? "bg-primary-ink" : "bg-muted-foreground/35",
			)}
			data-qa-id={`local-model-status-${modelId}`}
			data-status={loaded ? "loaded" : "not-loaded"}
			aria-hidden
		/>
	);
}

function ModelIcon({ model, publisher }: { model: LocalModel; publisher: string | undefined }) {
	if (publisher) {
		return (
			<ModelPublisherIcon
				publisher={publisher}
				size="lg"
				data-qa-id={`local-model-publisher-icon-${model.id}`}
			/>
		);
	}
	if (model.catalog) {
		return (
			<LibraryIcon
				className="text-muted-foreground"
				aria-hidden="true"
				data-qa-id={`local-model-catalog-icon-${model.id}`}
			/>
		);
	}
	return (
		<FileIcon
			className="text-muted-foreground"
			aria-hidden="true"
			data-qa-id={`local-model-file-icon-${model.id}`}
		/>
	);
}

function catalogQuantization(model: LocalModel, catalogModel: ModelCatalogEntry | undefined) {
	return catalogModel?.quantizations.find((entry) => entry.id === model.catalog?.quantizationId);
}

function modelSummary(model: LocalModel, catalogModel: ModelCatalogEntry | undefined): string {
	return (
		catalogQuantization(model, catalogModel)?.method ??
		(model.catalog ? "Catalog" : "Imported GGUF")
	);
}

function ModelActionsMenu({
	model,
	removing,
	onRemove,
	onReveal,
	onDelete,
}: Omit<ModelListActions, "onOpenCatalog"> & { model: LocalModel }) {
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={`More actions for ${modelDisplayName(model)}`}
						disabled={removing}
						data-qa-id={`local-model-actions-${model.id}`}
					/>
				}
			>
				<EllipsisIcon />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-max min-w-56 whitespace-nowrap">
				<DropdownMenuItem
					data-qa-id={`local-model-remove-${model.id}`}
					onClick={() => onRemove(model)}
				>
					<EjectIcon />
					Remove from model server
				</DropdownMenuItem>
				<DropdownMenuItem
					data-qa-id={`local-model-reveal-${model.id}`}
					onClick={() => onReveal(model)}
				>
					<FolderOpenIcon />
					{revealInFileManagerLabel()}
				</DropdownMenuItem>
				{model.managedFile ? (
					<>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							variant="destructive"
							data-qa-id={`local-model-delete-${model.id}`}
							onClick={() => onDelete(model)}
						>
							<Trash2Icon />
							Delete downloaded model
						</DropdownMenuItem>
					</>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function DetailList({ entries }: { entries: ReadonlyArray<readonly [string, string]> }) {
	return (
		<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
			{entries.map(([term, value]) => (
				<div key={term} className="contents">
					<dt className="text-muted-foreground">{term}</dt>
					<dd className="truncate text-right">{value}</dd>
				</div>
			))}
		</dl>
	);
}

function ModelAbout({
	model,
	catalogModel,
	onReveal,
	onOpenCatalog,
}: {
	model: LocalModel;
	catalogModel: ModelCatalogEntry | undefined;
	onReveal: (model: LocalModel) => void;
	onOpenCatalog: (model: ModelCatalogEntry) => void;
}) {
	const quantization = catalogQuantization(model, catalogModel);
	const sizeBytes = model.sizeBytes ?? quantization?.sizeBytes;
	const fileEntries: Array<readonly [string, string]> = [
		["Source", model.catalog ? "Catalog" : "Imported GGUF"],
	];
	if (quantization) fileEntries.push(["Quantization", quantization.method]);
	if (sizeBytes) fileEntries.push(["Size", formatFileSize(sizeBytes)]);

	return (
		<aside
			className="flex min-w-0 flex-col gap-4"
			aria-label={`About ${modelDisplayName(model)}`}
			data-qa-id={`local-model-about-${model.id}`}
		>
			{catalogModel ? (
				<div className="flex min-w-0 flex-col gap-2">
					<h4 className="text-sm font-medium">About</h4>
					<p className="text-muted-foreground line-clamp-4 text-xs leading-relaxed">
						{catalogModel.description}
					</p>
					<DetailList
						entries={[
							["Publisher", getPublisherDisplayName(catalogModel.publisher)],
							["Parameters", formatParameterCount(catalogModel.numParameters)],
							["Type", catalogModel.modelType],
						]}
					/>
					<Button
						type="button"
						variant="outline"
						size="xs"
						className="w-fit"
						data-qa-id={`local-model-view-catalog-${model.id}`}
						onClick={() => onOpenCatalog(catalogModel)}
					>
						View in catalog
						<ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
					</Button>
				</div>
			) : null}
			<div className="flex min-w-0 flex-col gap-2">
				<h4 className="text-sm font-medium">File</h4>
				<DetailList entries={fileEntries} />
				<Button
					type="button"
					variant="outline"
					size="xs"
					className="w-fit"
					data-qa-id={`local-model-about-reveal-${model.id}`}
					onClick={() => onReveal(model)}
				>
					<FolderOpenIcon data-icon="inline-start" aria-hidden="true" />
					{revealInFileManagerLabel()}
				</Button>
			</div>
		</aside>
	);
}

function ModelCard({
	model,
	catalogModel,
	loaded,
	open,
	onOpenChange,
	settings,
	removing,
	onRemove,
	onReveal,
	onDelete,
	onOpenCatalog,
}: ModelCardProps) {
	const publisher = model.catalog
		? (model.catalog.publisher ?? catalogModel?.publisher)
		: undefined;
	const name = modelDisplayName(model);
	const toggleLabel = `Toggle ${name} settings`;
	const detailsId = `local-model-details-${model.id}`;

	return (
		<Collapsible
			className="max-w-full min-w-0"
			open={open}
			onOpenChange={onOpenChange}
			data-qa-id={`local-model-item-${model.id}`}
			data-state={open ? "details-open" : "summary"}
		>
			<SummaryCard.Row data-qa-id={`local-model-header-${model.id}`}>
				<SummaryCard.Trigger
					type="button"
					aria-label={toggleLabel}
					data-qa-id={`local-model-trigger-${model.id}`}
				>
					<SummaryCard.Icon>
						<ModelIcon model={model} publisher={publisher} />
					</SummaryCard.Icon>
					<SummaryCard.Content>
						<SummaryCard.Title>
							<span className="truncate" data-qa-id={`local-model-title-${model.id}`}>
								{name}
							</span>
						</SummaryCard.Title>
						<SummaryCard.Description
							className="flex min-w-0 items-center gap-1.5"
							data-qa-id={`local-model-summary-${model.id}`}
						>
							<ModelStatusDot modelId={model.id} loaded={loaded} />
							<span className="shrink-0">{loaded ? "Loaded" : "Not loaded"}</span>
							<span aria-hidden="true">·</span>
							<span className="truncate">{modelSummary(model, catalogModel)}</span>
						</SummaryCard.Description>
					</SummaryCard.Content>
				</SummaryCard.Trigger>
				<SummaryCard.Actions className="gap-1">
					<ModelActionsMenu
						model={model}
						removing={removing}
						onRemove={onRemove}
						onReveal={onReveal}
						onDelete={onDelete}
					/>
					<SummaryCard.Toggle
						label={toggleLabel}
						open={open}
						data-qa-id={`local-model-chevron-${model.id}`}
					/>
				</SummaryCard.Actions>
			</SummaryCard.Row>
			<CollapsibleContent>
				<section
					id={detailsId}
					aria-label={`${name} model settings`}
					className="border-border bg-background/60 grid min-w-0 items-start gap-6 border-t p-4 @2xl:grid-cols-[minmax(0,1fr)_15rem]"
					data-qa-id={detailsId}
					data-model-id={model.id}
				>
					{settings}
					<ModelAbout
						model={model}
						catalogModel={catalogModel}
						onReveal={onReveal}
						onOpenCatalog={onOpenCatalog}
					/>
				</section>
			</CollapsibleContent>
		</Collapsible>
	);
}

/**
 * Models render as expandable summary cards (matching the marketplace's
 * installed list); expanding a card reveals that model's settings editor.
 * The parent owns which cards are open so several can be compared at once.
 */
export function ModelList({
	models,
	catalogModels,
	loadedModelIds,
	expandedModelIds,
	onExpandedChange,
	renderSettings,
	...actions
}: ModelListActions & {
	models: readonly LocalModel[];
	catalogModels: ReadonlyMap<string, ModelCatalogEntry>;
	loadedModelIds: ReadonlySet<string>;
	expandedModelIds: ReadonlySet<string>;
	onExpandedChange: (modelId: string, open: boolean) => void;
	renderSettings: (model: LocalModel) => ReactNode;
}) {
	return (
		<div
			role="list"
			aria-label="Available models"
			className="border-border bg-card divide-border @container min-w-0 divide-y overflow-hidden rounded-lg border"
			data-qa-id="local-model-list"
		>
			{models.map((model) => {
				const open = expandedModelIds.has(model.id);
				return (
					<div key={model.id} role="listitem" className="min-w-0">
						<ModelCard
							model={model}
							catalogModel={model.catalog ? catalogModels.get(model.catalog.modelId) : undefined}
							loaded={loadedModelIds.has(model.id)}
							open={open}
							onOpenChange={(next) => onExpandedChange(model.id, next)}
							settings={open ? renderSettings(model) : null}
							{...actions}
						/>
					</div>
				);
			})}
		</div>
	);
}
