import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";

const PLACEHOLDER_ROWS = ["first", "second", "third", "fourth"];

/**
 * Placeholder for a search + view-menu toolbar: a small `InputGroup` and an
 * `icon-sm` button. Both are 28px tall with the `rounded-md` radius the
 * skeleton already uses.
 */
export function ToolbarSkeleton() {
	return (
		<div className="flex shrink-0 items-center gap-2" aria-hidden="true">
			<Skeleton className="h-7 min-w-40 flex-1" />
			<Skeleton className="size-7" />
		</div>
	);
}

/**
 * Placeholder shaped like the environments toolbar and joined row list.
 * Shared by the page (while the provider status resolves) and the Conda panel
 * (while the environment list loads) so the two waits read as one state.
 */
export function EnvironmentsListSkeleton() {
	return (
		<div
			role="status"
			aria-busy="true"
			aria-label="Loading environments"
			className="flex min-h-0 flex-col gap-4"
			data-qa-id="environments-conda-loading"
		>
			<span className="sr-only">Loading environments</span>
			<ToolbarSkeleton />
			<div
				className="border-border bg-card divide-border divide-y overflow-hidden rounded-lg border"
				aria-hidden="true"
			>
				{PLACEHOLDER_ROWS.map((row) => (
					<SummaryCard.Row key={row}>
						<SummaryCard.Content>
							<SummaryCard.Title>
								<SkeletonText className="w-32" />
							</SummaryCard.Title>
							<SummaryCard.Description>
								<SkeletonText className="w-64" />
							</SummaryCard.Description>
						</SummaryCard.Content>
						<SummaryCard.Actions>
							<Skeleton className="size-7" />
						</SummaryCard.Actions>
					</SummaryCard.Row>
				))}
			</div>
		</div>
	);
}
