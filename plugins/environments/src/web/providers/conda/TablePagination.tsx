import { useMemo } from "react";

import {
	Pagination,
	PaginationContent,
	PaginationEllipsis,
	PaginationItem,
	PaginationLink,
	PaginationNext,
	PaginationPrevious,
} from "@kilo-desktop/ui/components/pagination";
import { Field, FieldLabel } from "@kilo-desktop/ui/components/field";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { cn } from "@kilo-desktop/ui/lib/utils";

import { computePageNumbers } from "./compute-page-numbers.js";

/**
 * The one pager for every table in this feature.
 *
 * Every table previously rolled its own controls, which drifted apart in layout,
 * labelling, and even the dash used in the range text. Keeping a single component
 * means a change to the pattern lands everywhere at once.
 *
 * Page indices are zero-based to match `computePageNumbers` and the callers that
 * already track pages that way; only the rendered labels are one-based.
 */
export function TablePagination({
	pageIndex,
	pageCount,
	onPageChange,
	rangeStart,
	rangeEnd,
	totalItems,
	itemLabel = "items",
	pageSize,
	pageSizeOptions,
	onPageSizeChange,
	qaPrefix,
	pageSizeQaId,
	className,
}: {
	/** Zero-based index of the current page. */
	pageIndex: number;
	pageCount: number;
	onPageChange: (pageIndex: number) => void;
	rangeStart: number;
	rangeEnd: number;
	totalItems: number;
	itemLabel?: string;
	/** Omit the rows-per-page control by leaving these three undefined. */
	pageSize?: number;
	pageSizeOptions?: readonly number[];
	onPageSizeChange?: (value: string | null) => void;
	qaPrefix: string;
	pageSizeQaId?: string;
	className?: string;
}) {
	const pageItems = useMemo(() => computePageNumbers(pageIndex, pageCount), [pageIndex, pageCount]);
	const atFirst = pageIndex <= 0;
	const atLast = pageIndex >= pageCount - 1;
	const selectId = `${qaPrefix}-rows-per-page`;
	const showPageSize =
		pageSize !== undefined && pageSizeOptions !== undefined && onPageSizeChange !== undefined;

	return (
		<div
			className={cn("flex shrink-0 items-center justify-between gap-4", className)}
			data-qa-id={qaPrefix}
		>
			<div className="flex items-center gap-3">
				{showPageSize && (
					<Field orientation="horizontal" className="w-fit">
						<FieldLabel htmlFor={selectId}>Rows per page</FieldLabel>
						<Select value={String(pageSize)} onValueChange={onPageSizeChange}>
							<SelectTrigger
								id={selectId}
								className="w-20"
								data-qa-id={pageSizeQaId ?? `${qaPrefix}-items-per-page`}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent align="start">
								<SelectGroup>
									{pageSizeOptions.map((option) => (
										<SelectItem key={option} value={String(option)}>
											{option}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</Field>
				)}
				<span className="text-muted-foreground text-sm whitespace-nowrap">
					{rangeStart} – {rangeEnd} of {totalItems} {itemLabel}
				</span>
			</div>

			<Pagination className="mx-0 w-auto">
				<PaginationContent>
					<PaginationItem>
						<PaginationPrevious
							data-qa-id={`${qaPrefix}-prev`}
							aria-disabled={atFirst}
							className={cn(atFirst && "pointer-events-none opacity-50")}
							onClick={() => {
								if (!atFirst) onPageChange(pageIndex - 1);
							}}
						/>
					</PaginationItem>

					{pageItems.map((item, index) =>
						item === "ellipsis" ? (
							<PaginationItem key={`ellipsis-${index}`}>
								<PaginationEllipsis />
							</PaginationItem>
						) : (
							<PaginationItem key={item}>
								<PaginationLink
									isActive={item === pageIndex}
									aria-label={`Go to page ${item + 1}`}
									onClick={() => onPageChange(item)}
								>
									{item + 1}
								</PaginationLink>
							</PaginationItem>
						),
					)}

					<PaginationItem>
						<PaginationNext
							data-qa-id={`${qaPrefix}-next`}
							aria-disabled={atLast}
							className={cn(atLast && "pointer-events-none opacity-50")}
							onClick={() => {
								if (!atLast) onPageChange(pageIndex + 1);
							}}
						/>
					</PaginationItem>
				</PaginationContent>
			</Pagination>
		</div>
	);
}
