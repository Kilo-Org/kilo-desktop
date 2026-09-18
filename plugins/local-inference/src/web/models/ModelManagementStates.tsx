import { LibraryIcon, SearchXIcon } from "lucide-react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";

export function ModelListSkeleton() {
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

export function ModelSettingsSkeleton() {
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

export function NoModelsEmptyState({ failed }: { failed: boolean }) {
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

export function NoMatchingModelsState({ onClear }: { onClear: () => void }) {
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
