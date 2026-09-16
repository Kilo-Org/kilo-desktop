import {
	ArrowRightIcon,
	createLucideIcon,
	FileIcon,
	FolderOpenIcon,
	LibraryIcon,
	MoreHorizontalIcon,
	Trash2Icon,
} from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { Badge } from "@anaconda-agentic-desktop/ui/components/badge";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	PreviewCard,
	PreviewCardContent,
	PreviewCardTrigger,
} from "@anaconda-agentic-desktop/ui/components/preview-card";
import {
	SidebarMenu,
	SidebarMenuAction,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@anaconda-agentic-desktop/ui/components/sidebar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type { LocalModel, ModelCatalogEntry } from "../../contracts/schemas.js";
import { getPublisherDisplayName, ModelPublisherIcon } from "../catalog/ModelPublisherIcon.js";

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

function ModelStatusDot({ modelId, loaded }: { modelId: string; loaded: boolean }) {
	return (
		<span
			className={cn(
				"size-2 shrink-0 rounded-full",
				loaded ? "bg-primary" : "bg-muted-foreground/35",
			)}
			data-qa-id={`local-model-status-${modelId}`}
			data-status={loaded ? "loaded" : "not-loaded"}
			aria-hidden
		/>
	);
}

const compactNumberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function formatParameterCount(parameters: number): string {
	if (parameters >= 1_000_000_000) {
		return `${compactNumberFormatter.format(parameters / 1_000_000_000)}B`;
	}

	if (parameters >= 1_000_000) {
		return `${compactNumberFormatter.format(parameters / 1_000_000)}M`;
	}

	return compactNumberFormatter.format(parameters);
}

function formatFileSize(bytes: number): string {
	return `${compactNumberFormatter.format(bytes / 1024 ** 3)} GB`;
}

function ModelSidebarButtonContent({
	model,
	publisher,
	loaded,
}: {
	model: LocalModel;
	publisher: string | undefined;
	loaded: boolean;
}) {
	return (
		<>
			{publisher ? (
				<ModelPublisherIcon
					publisher={publisher}
					size="lg"
					data-qa-id={`local-model-publisher-icon-${model.id}`}
				/>
			) : model.catalog ? (
				<LibraryIcon
					className="text-muted-foreground"
					aria-hidden="true"
					data-qa-id={`local-model-catalog-icon-${model.id}`}
				/>
			) : (
				<FileIcon
					className="text-muted-foreground"
					aria-hidden="true"
					data-qa-id={`local-model-file-icon-${model.id}`}
				/>
			)}
			<div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
				<span
					className="truncate text-sm leading-4 font-medium"
					data-qa-id={`local-model-title-${model.id}`}
				>
					{model.name}
				</span>
				<span className="text-muted-foreground flex items-center gap-1.5 text-[11px] leading-none">
					<ModelStatusDot modelId={model.id} loaded={loaded} />
					{loaded ? "Loaded" : "Not loaded"}
				</span>
			</div>
		</>
	);
}

function LocalFileModelSidebarButton({
	model,
	publisher,
	loaded,
	selected,
	onSelect,
	onReveal,
}: {
	model: LocalModel;
	publisher: string | undefined;
	loaded: boolean;
	selected: boolean;
	onSelect: (modelId: string) => void;
	onReveal: (model: LocalModel) => void;
}) {
	const sourceLabel = model.catalog ? "Catalog download" : "Imported GGUF";
	const selectModel = (event: ReactMouseEvent<HTMLButtonElement>) => {
		onSelect(model.id);
		event.currentTarget.blur();
	};

	return (
		<PreviewCard>
			<PreviewCardTrigger
				delay={250}
				closeDelay={150}
				render={
					<SidebarMenuButton
						type="button"
						size="lg"
						isActive={selected}
						aria-pressed={selected}
						className="data-active:bg-foreground/5 data-active:hover:bg-foreground/5 rounded-lg"
						data-qa-id={`local-model-select-${model.id}`}
						onClick={selectModel}
					/>
				}
			>
				<ModelSidebarButtonContent model={model} publisher={publisher} loaded={loaded} />
			</PreviewCardTrigger>
			<PreviewCardContent
				side="right"
				align="start"
				sideOffset={8}
				className="w-72 gap-2 p-2.5"
				data-qa-id={`local-model-file-preview-${model.id}`}
			>
				<div className="flex flex-col gap-0.5 text-sm">
					<div className="flex items-center gap-2">
						{publisher ? (
							<ModelPublisherIcon publisher={publisher} size="lg" />
						) : model.catalog ? (
							<LibraryIcon className="text-muted-foreground size-4" aria-hidden="true" />
						) : (
							<FileIcon className="text-muted-foreground size-4" aria-hidden="true" />
						)}
						<h3 className="min-w-0 truncate font-medium">{model.name}</h3>
					</div>
					<p className="text-muted-foreground text-xs">
						{sourceLabel}
						{model.sizeBytes ? ` · ${formatFileSize(model.sizeBytes)}` : ""}
					</p>
				</div>
				<code
					className="bg-muted/60 rounded-md px-2 py-1.5 text-[11px] leading-4 break-all"
					aria-label={`File location: ${model.path}`}
					data-qa-id={`local-model-path-${model.id}`}
				>
					{model.path}
				</code>
				<Button
					type="button"
					variant="link"
					size="xs"
					className="h-auto w-fit p-0"
					data-qa-id={`local-model-file-preview-reveal-${model.id}`}
					onClick={() => {
						onReveal(model);
					}}
				>
					Show in Finder
					<FolderOpenIcon data-icon="inline-end" aria-hidden="true" />
				</Button>
			</PreviewCardContent>
		</PreviewCard>
	);
}

function CatalogModelSidebarButton({
	model,
	catalogModel,
	publisher,
	loaded,
	selected,
	onSelect,
	onOpenCatalog,
}: {
	model: LocalModel;
	catalogModel: ModelCatalogEntry;
	publisher: string | undefined;
	loaded: boolean;
	selected: boolean;
	onSelect: (modelId: string) => void;
	onOpenCatalog: (model: ModelCatalogEntry) => void;
}) {
	const quantization = catalogModel.quantizations.find(
		(entry) => entry.id === model.catalog?.quantizationId,
	);
	const selectModel = (event: ReactMouseEvent<HTMLButtonElement>) => {
		onSelect(model.id);
		event.currentTarget.blur();
	};

	return (
		<PreviewCard>
			<PreviewCardTrigger
				delay={250}
				closeDelay={150}
				render={
					<SidebarMenuButton
						type="button"
						size="lg"
						isActive={selected}
						aria-pressed={selected}
						className="data-active:bg-foreground/5 data-active:hover:bg-foreground/5 rounded-lg"
						data-qa-id={`local-model-select-${model.id}`}
						onClick={selectModel}
					/>
				}
			>
				<ModelSidebarButtonContent model={model} publisher={publisher} loaded={loaded} />
			</PreviewCardTrigger>
			<PreviewCardContent
				side="right"
				align="start"
				sideOffset={8}
				className="w-80 gap-3 p-3"
				data-qa-id={`local-model-catalog-preview-${model.id}`}
			>
				<div className="flex flex-col gap-1 text-sm">
					<div className="flex items-center gap-2">
						<ModelPublisherIcon publisher={catalogModel.publisher} size="lg" />
						<h3 className="min-w-0 truncate font-medium">{catalogModel.name}</h3>
					</div>
					<p className="text-muted-foreground text-xs">
						{getPublisherDisplayName(catalogModel.publisher)} ·{" "}
						{formatParameterCount(catalogModel.numParameters)} parameters · {catalogModel.modelType}
					</p>
				</div>
				<p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
					{catalogModel.description}
				</p>
				{quantization ? (
					<div className="flex flex-wrap gap-1.5">
						<Badge variant="outline">{quantization.method}</Badge>
						<Badge variant="outline">{formatFileSize(quantization.sizeBytes)}</Badge>
					</div>
				) : null}
				<Button
					type="button"
					variant="link"
					size="sm"
					className="h-auto w-fit p-0"
					data-qa-id={`local-model-view-catalog-${model.id}`}
					onClick={() => {
						onOpenCatalog(catalogModel);
					}}
				>
					View in catalog
					<ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
				</Button>
			</PreviewCardContent>
		</PreviewCard>
	);
}

export function ModelSidebar({
	models,
	catalogModels,
	loadedModelIds,
	selectedModelId,
	removing,
	onSelect,
	onRemove,
	onReveal,
	onDelete,
	onOpenCatalog,
}: {
	models: readonly LocalModel[];
	catalogModels: ReadonlyMap<string, ModelCatalogEntry>;
	loadedModelIds: ReadonlySet<string>;
	selectedModelId: string | undefined;
	removing: boolean;
	onSelect: (modelId: string) => void;
	onRemove: (model: LocalModel) => void;
	onReveal: (model: LocalModel) => void;
	onDelete: (model: LocalModel) => void;
	onOpenCatalog: (model: ModelCatalogEntry) => void;
}) {
	return (
		<nav aria-label="Available models" className="min-w-0">
			<SidebarMenu className="gap-px">
				{models.map((model) => {
					const selected = model.id === selectedModelId;
					const loaded = loadedModelIds.has(model.id);
					const catalogModel = model.catalog ? catalogModels.get(model.catalog.modelId) : undefined;
					const publisher = model.catalog
						? (model.catalog.publisher ?? catalogModel?.publisher)
						: undefined;
					return (
						<SidebarMenuItem key={model.id}>
							{catalogModel ? (
								<CatalogModelSidebarButton
									model={model}
									catalogModel={catalogModel}
									publisher={publisher}
									loaded={loaded}
									selected={selected}
									onSelect={onSelect}
									onOpenCatalog={onOpenCatalog}
								/>
							) : (
								<LocalFileModelSidebarButton
									model={model}
									publisher={publisher}
									loaded={loaded}
									selected={selected}
									onSelect={onSelect}
									onReveal={onReveal}
								/>
							)}
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<SidebarMenuAction
											type="button"
											className="top-1/2! -translate-y-1/2"
											aria-label={`More actions for ${model.name}`}
											disabled={removing}
											data-qa-id={`local-model-actions-${model.id}`}
										/>
									}
								>
									<MoreHorizontalIcon />
								</DropdownMenuTrigger>
								<DropdownMenuContent
									align="end"
									side="right"
									className="w-max min-w-56 whitespace-nowrap"
								>
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
										Show in Finder
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
						</SidebarMenuItem>
					);
				})}
			</SidebarMenu>
		</nav>
	);
}
