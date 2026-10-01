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
import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";

export function ModelListSkeleton() {
	return (
		<div
			className="flex min-w-0 flex-col gap-3"
			role="status"
			aria-busy="true"
			aria-label="Loading models"
			data-qa-id="local-model-list-skeleton"
		>
			<div className="flex items-center gap-1">
				<Skeleton className="h-7 min-w-0 flex-1" />
				<Skeleton className="size-7 shrink-0" />
			</div>
			<div className="border-border bg-card divide-border divide-y overflow-hidden rounded-lg border">
				{["w-40", "w-32"].map((titleWidth) => (
					<SummaryCard.Row key={titleWidth}>
						<div className="flex min-w-0 flex-1 items-center gap-2.5">
							<SummaryCard.Icon>
								<Skeleton className="size-4 rounded-sm" />
							</SummaryCard.Icon>
							<SummaryCard.Content>
								<SummaryCard.Title>
									<SkeletonText className={titleWidth} />
								</SummaryCard.Title>
								<SummaryCard.Description>
									<SkeletonText className="w-36" />
								</SummaryCard.Description>
							</SummaryCard.Content>
						</div>
						<SummaryCard.Actions className="gap-1">
							<Skeleton className="size-7" />
							<Skeleton className="size-7" />
						</SummaryCard.Actions>
					</SummaryCard.Row>
				))}
			</div>
		</div>
	);
}

export function NoModelsEmptyState({
	failed,
	catalogEnabled,
}: {
	failed: boolean;
	catalogEnabled: boolean;
}) {
	return (
		<Empty data-qa-id="local-model-list-empty">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<LibraryIcon aria-hidden="true" />
				</EmptyMedia>
				<EmptyTitle>{failed ? "Models could not be loaded" : "No models added"}</EmptyTitle>
				<EmptyDescription>
					{failed
						? "Try reopening this page."
						: catalogEnabled
							? "Add a model from the catalog or import a GGUF file to get started."
							: "Import a GGUF file to get started."}
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}

export function NoMatchingModelsState({ onClear }: { onClear: () => void }) {
	return (
		<Empty className="border" data-qa-id="local-model-filter-empty">
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
