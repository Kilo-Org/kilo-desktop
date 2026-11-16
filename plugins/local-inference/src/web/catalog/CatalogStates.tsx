import { CircleAlertIcon, LibraryIcon, LogInIcon, RefreshCwIcon, SearchXIcon } from "lucide-react";

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
import { TableCell, TableRow } from "@kilo-desktop/ui/components/table";

import { catalogTableCellClassNames, ModelCatalogTableFrame } from "./ModelCatalogTableLayout";
import { ModelIdentitySkeleton } from "./ModelIdentity";
import { ModelPerformanceSkeleton } from "./ModelPerformance";

// Distinct widths double as stable keys; row counts match the loaded views
// (up to three recommendations per group).
const recommendationNameWidths = ["w-32", "w-28", "w-36"];
const catalogRowNameWidths = ["w-40", "w-32", "w-44", "w-36"];

export function ModelCatalogLoading() {
	return (
		<div
			className="flex flex-col gap-6"
			role="status"
			aria-busy="true"
			aria-label="Loading model catalog"
			data-qa-id="model-catalog-loading"
		>
			<section>
				<div className="mb-3 text-sm font-medium">
					<SkeletonText className="w-36" />
				</div>
				<div className="grid gap-3 lg:grid-cols-2">
					{["coding", "lightweight"].map((group) => (
						<div
							key={group}
							className="border-border bg-card min-w-0 rounded-xl border px-4 pt-3 pb-4"
						>
							<div className="mb-2 flex items-center gap-2">
								<Skeleton className="size-4 rounded-sm" />
								<div className="text-sm font-medium">
									<SkeletonText className="w-28" />
								</div>
							</div>
							<div className="divide-border divide-y">
								{recommendationNameWidths.map((nameWidth) => (
									<div
										key={nameWidth}
										className="-mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center justify-between gap-4 overflow-hidden border border-transparent bg-clip-padding p-2 text-sm last:-mb-2"
									>
										<ModelIdentitySkeleton compact nameClassName={nameWidth} />
										<ModelPerformanceSkeleton stackOnNarrow />
									</div>
								))}
							</div>
						</div>
					))}
				</div>
			</section>
			<section className="flex flex-col gap-4">
				<div className="flex items-center gap-2">
					<Skeleton className="h-7 min-w-0 flex-1" />
					<Skeleton className="size-7 shrink-0" />
				</div>
				<ModelCatalogTableFrame aria-hidden="true">
					{catalogRowNameWidths.map((nameWidth) => (
						<TableRow key={nameWidth} className="hover:bg-transparent">
							<TableCell className={catalogTableCellClassNames.model}>
								<ModelIdentitySkeleton nameClassName={nameWidth} />
							</TableCell>
							<TableCell className={catalogTableCellClassNames.capabilities}>
								<Skeleton className="h-5 w-12 rounded-full" />
							</TableCell>
							<TableCell className={catalogTableCellClassNames.performance}>
								<ModelPerformanceSkeleton fixedFitWidth wrap />
							</TableCell>
						</TableRow>
					))}
				</ModelCatalogTableFrame>
			</section>
		</div>
	);
}

export function ModelCatalogNoResults({ onClear }: { onClear: () => void }) {
	return (
		<Empty className="border" data-qa-id="model-catalog-search-empty">
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

/**
 * The catalog needs its account (`title`'s, e.g. Anaconda). Signing in runs
 * the catalog's browser flow; it does not change the app (Kilo) session.
 */
export function ModelCatalogSignIn({
	title,
	signingIn,
	onSignIn,
	onCancel,
}: {
	title: string;
	signingIn: boolean;
	onSignIn: () => void;
	onCancel: () => void;
}) {
	return (
		<Empty data-qa-id="model-catalog-sign-in">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<LibraryIcon />
				</EmptyMedia>
				<EmptyTitle>{`Sign in to ${title}`}</EmptyTitle>
				<EmptyDescription>
					{`The model catalog uses your ${title} account. Sign in to browse and download models.`}
				</EmptyDescription>
			</EmptyHeader>
			<EmptyContent className="flex-row justify-center">
				<Button
					variant="outline"
					disabled={signingIn}
					onClick={onSignIn}
					data-qa-id="model-catalog-sign-in-button"
				>
					<LogInIcon data-icon="inline-start" />
					{signingIn ? "Waiting for browser…" : `Sign in to ${title}`}
				</Button>
				{signingIn ? (
					<Button variant="ghost" onClick={onCancel} data-qa-id="model-catalog-cancel-sign-in">
						Cancel
					</Button>
				) : null}
			</EmptyContent>
		</Empty>
	);
}

/** `title` is the catalog's (e.g. Anaconda); null without one. */
export function ModelCatalogEmpty({ title }: { title: string | null }) {
	return (
		<Empty data-qa-id="model-catalog-empty">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<LibraryIcon />
				</EmptyMedia>
				<EmptyTitle>No models available</EmptyTitle>
				<EmptyDescription>
					{title === null
						? "No models are available."
						: `Your ${title} account has no models available.`}
				</EmptyDescription>
			</EmptyHeader>
		</Empty>
	);
}
