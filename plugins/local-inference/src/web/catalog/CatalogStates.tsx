import { CircleAlertIcon, LibraryIcon, RefreshCwIcon, SearchXIcon } from "lucide-react";

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

export function ModelCatalogLoading() {
	return (
		<div
			className="[&_[data-slot=skeleton]]:bg-muted-foreground/25 flex flex-col gap-6"
			aria-label="Loading model catalog"
			data-qa-id="model-catalog-loading"
		>
			<section>
				<Skeleton className="mb-3 h-4 w-36" />
				<div className="grid gap-3 lg:grid-cols-2">
					{["coding", "lightweight"].map((group) => (
						<div key={group} className="border-border flex flex-col gap-3 rounded-lg border p-3">
							<div className="flex items-center gap-2">
								<Skeleton className="size-4 rounded-sm" />
								<Skeleton className="h-3.5 w-28" />
							</div>
							<Skeleton className="h-10 w-full" />
						</div>
					))}
				</div>
			</section>
			<section className="flex flex-col gap-2">
				<div className="flex items-center justify-between gap-3">
					<Skeleton className="h-4 w-20" />
					<div className="flex items-center gap-2">
						<Skeleton className="h-7 w-40 rounded-lg" />
						<Skeleton className="h-7 w-36 rounded-lg" />
					</div>
				</div>
				<div className="border-border overflow-hidden rounded-lg border">
					<div className="border-border grid h-10 grid-cols-[minmax(0,1fr)_8rem] items-center gap-4 border-b px-3">
						<Skeleton className="h-3 w-16" />
						<Skeleton className="h-3 w-20" />
					</div>
					{["first", "second", "third", "fourth"].map((row) => (
						<div
							key={row}
							className="border-border grid h-16 grid-cols-[minmax(0,1fr)_8rem] items-center gap-4 border-b px-3 last:border-b-0"
						>
							<div className="flex min-w-0 items-center gap-2">
								<Skeleton className="size-3.5 shrink-0 rounded-sm" />
								<div className="flex min-w-0 flex-1 flex-col gap-1.5">
									<Skeleton className={row === "second" ? "h-3.5 w-3/5" : "h-3.5 w-4/5"} />
									<Skeleton className="h-2.5 w-20" />
								</div>
							</div>
							<Skeleton className="h-5 w-24 rounded-full" />
						</div>
					))}
				</div>
			</section>
		</div>
	);
}

export function ModelCatalogNoResults({ onClear }: { onClear: () => void }) {
	return (
		<Empty
			className="min-h-48 gap-3 rounded-lg border border-dashed p-4"
			data-qa-id="model-catalog-search-empty"
		>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<SearchXIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>No matching models</EmptyTitle>
				<EmptyDescription>Try a different model name or publisher.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button type="button" variant="outline" size="sm" onClick={onClear}>
					Clear search
				</Button>
			</EmptyContent>
		</Empty>
	);
}

export function ModelCatalogError({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<Empty data-qa-id="model-catalog-error">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<CircleAlertIcon />
				</EmptyMedia>
				<EmptyTitle>Could not load models</EmptyTitle>
				<EmptyDescription>{message}</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button variant="outline" onClick={onRetry}>
					<RefreshCwIcon data-icon="inline-start" />
					Try again
				</Button>
			</EmptyContent>
		</Empty>
	);
}

export function ModelCatalogEmpty() {
	return (
		<Empty data-qa-id="model-catalog-empty">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<LibraryIcon />
				</EmptyMedia>
				<EmptyTitle>No models available</EmptyTitle>
				<EmptyDescription>Your Anaconda account has no models available.</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
