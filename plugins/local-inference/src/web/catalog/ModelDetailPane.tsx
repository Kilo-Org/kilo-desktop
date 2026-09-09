import { BinaryIcon, EyeIcon, LibraryIcon, MessageCircleIcon, WrenchIcon } from "lucide-react";

import { Badge } from "@anaconda-agentic-desktop/ui/components/badge";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@anaconda-agentic-desktop/ui/components/empty";
import { ScrollArea } from "@anaconda-agentic-desktop/ui/components/scroll-area";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type {
	LocalInferenceHardwareProfile,
	LocalModel,
	ModelCatalogEntry,
	ModelDownload,
} from "../../contracts/schemas.js";
import type { DownloadIdentity } from "./catalog-downloads.js";
import { ModelDownloadSection } from "./ModelDownloadSection.js";
import { getPublisherDisplayName, ModelPublisherIcon } from "./ModelPublisherIcon.js";
import { formatParameterCount } from "../models/model-format.js";

const capabilityBadgeDefinitions = [
	{ id: "chat", label: "Chat", icon: MessageCircleIcon },
	{ id: "toolCalling", label: "Tool calling", icon: WrenchIcon },
	{ id: "vision", label: "Vision", icon: EyeIcon },
	{ id: "embedding", label: "Embeddings", icon: BinaryIcon },
] as const;

const interactiveScrollbarClassName =
	"[&_[data-slot=scroll-area-scrollbar]]:opacity-0 hover:[&_[data-slot=scroll-area-scrollbar]]:opacity-100 focus-within:[&_[data-slot=scroll-area-scrollbar]]:opacity-100";

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

export function ModelDetailPane({
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

export function ModelDetailEmpty() {
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

export function ModelDetailSkeleton() {
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
