import { useMemo, useState } from "react";

import {
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronsLeftIcon,
	ChevronsRightIcon,
	ArrowUpDownIcon,
	ArrowUpIcon,
	ArrowDownIcon,
	EllipsisVerticalIcon,
	PlusIcon,
	SearchIcon,
} from "lucide-react";

import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anaconda-agentic-desktop/ui/components/select";
import { Skeleton } from "@anaconda-agentic-desktop/ui/components/skeleton";
import { useSdk, useSdkQuery } from "@anaconda-agentic-desktop/sdk-react";

import type { CondaEnv, CondaPackage, CondaService } from "../../../contracts/providers/conda.js";
import { computePageNumbers } from "./compute-page-numbers.js";
import { environmentDisplayName } from "./environment-display.js";

type SortField = "name" | "version";
type SortDirection = "asc" | "desc";

interface EnvironmentDetailProps {
	env: CondaEnv;
	onBack: () => void;
}

const PAGE_SIZES = [20, 50, 100] as const;

export function EnvironmentDetail({ env, onBack }: EnvironmentDetailProps) {
	const sdk = useSdk<CondaService>("environments");
	const displayName = environmentDisplayName(env);
	// The bridge's `conda.list` accepts "base" as the name for the base
	// environment (`conda list -n base`). The contract schema requires a
	// non-empty string so we cannot pass an empty name.
	const queryName = env.name || "base";
	const packages = useSdkQuery(sdk, "conda.packages.list", {
		envName: queryName,
		prefix: env.prefix,
	});

	const [search, setSearch] = useState("");
	const [sortField, setSortField] = useState<SortField>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState<number>(20);

	const filtered = useMemo(() => {
		const list = packages.data?.packages ?? [];
		const query = search.trim().toLowerCase();
		if (!query) return list;
		return list.filter((pkg) => pkg.name.toLowerCase().includes(query));
	}, [packages.data?.packages, search]);

	const sorted = useMemo(() => {
		const items = [...filtered];
		items.sort((a, b) => {
			const aVal = a[sortField].toLowerCase();
			const bVal = b[sortField].toLowerCase();
			const cmp = aVal.localeCompare(bVal);
			return sortDirection === "asc" ? cmp : -cmp;
		});
		return items;
	}, [filtered, sortField, sortDirection]);

	const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
	const safePage = Math.min(page, totalPages - 1);
	const paginatedPackages = sorted.slice(safePage * pageSize, (safePage + 1) * pageSize);
	const rangeStart = sorted.length === 0 ? 0 : safePage * pageSize + 1;
	const rangeEnd = Math.min((safePage + 1) * pageSize, sorted.length);

	function handleSort(field: SortField) {
		if (sortField === field) {
			setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
		} else {
			setSortField(field);
			setSortDirection("asc");
		}
		setPage(0);
	}

	function handleSearch(value: string) {
		setSearch(value);
		setPage(0);
	}

	function handlePageSizeChange(value: string | null) {
		if (!value) return;
		setPageSize(Number(value));
		setPage(0);
	}

	return (
		<TooltipProvider>
			<div className="flex min-h-0 flex-1 flex-col" data-qa-id="environments-conda-detail">
				{/* Back button */}
				<button
					type="button"
					onClick={onBack}
					className="text-primary mb-4 flex cursor-pointer items-center gap-1 text-sm font-medium hover:underline"
					data-qa-id="environments-conda-detail-back"
				>
					<ChevronLeftIcon className="size-4" />
					Back
				</button>

				{/* Header */}
				<div className="mb-6 flex items-start justify-between">
					<div>
						<h2
							className="text-xl font-semibold tracking-tight"
							data-qa-id="environments-conda-detail-name"
						>
							{displayName}
						</h2>
						<p
							className="text-muted-foreground mt-0.5 font-mono text-xs"
							data-qa-id="environments-conda-detail-prefix"
						>
							{env.prefix}
						</p>
					</div>
					<div className="flex items-center gap-2">
						<Tooltip>
							<TooltipTrigger render={<span className="inline-flex" />}>
								<Button
									variant="default"
									size="default"
									data-qa-id="environments-conda-detail-add-pkg"
									disabled
								>
									<PlusIcon data-icon="inline-start" className="size-4" />
									Package
								</Button>
							</TooltipTrigger>
							<TooltipContent>Soon</TooltipContent>
						</Tooltip>
						<Tooltip>
							<TooltipTrigger render={<span className="inline-flex" />}>
								<Button variant="ghost" size="icon" disabled aria-label="More actions">
									<EllipsisVerticalIcon className="size-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>Soon</TooltipContent>
						</Tooltip>
					</div>
				</div>

				{/* Search */}
				<div className="relative mb-4 max-w-sm">
					<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
					<Input
						type="text"
						placeholder="Search"
						value={search}
						onChange={(e) => handleSearch(e.target.value)}
						className="pl-9"
						data-qa-id="environments-conda-detail-search"
					/>
				</div>

				{/* Content */}
				{packages.isPending && <PackagesLoading />}
				{packages.isError && (
					<p
						className="text-destructive text-sm"
						role="alert"
						data-qa-id="environments-conda-detail-error"
					>
						Could not load packages: {packages.error.message}
					</p>
				)}
				{packages.isSuccess && sorted.length === 0 && search && (
					<p className="text-muted-foreground text-sm" data-qa-id="environments-conda-detail-empty">
						No packages match &ldquo;{search}&rdquo;.
					</p>
				)}
				{packages.isSuccess && (packages.data?.packages.length ?? 0) === 0 && !search && (
					<p className="text-muted-foreground text-sm" data-qa-id="environments-conda-detail-empty">
						No packages installed in this environment.
					</p>
				)}
				{packages.isSuccess && paginatedPackages.length > 0 && (
					<>
						<PackagesTable
							packages={paginatedPackages}
							sortField={sortField}
							sortDirection={sortDirection}
							onSort={handleSort}
						/>
						<Pagination
							page={safePage}
							totalPages={totalPages}
							pageSize={pageSize}
							rangeStart={rangeStart}
							rangeEnd={rangeEnd}
							totalItems={sorted.length}
							onPageChange={setPage}
							onPageSizeChange={handlePageSizeChange}
						/>
					</>
				)}
			</div>
		</TooltipProvider>
	);
}

function SortIcon({
	field,
	activeField,
	direction,
}: {
	field: SortField;
	activeField: SortField;
	direction: SortDirection;
}) {
	if (field !== activeField) {
		return <ArrowUpDownIcon className="text-muted-foreground size-3.5" />;
	}
	return direction === "asc" ? (
		<ArrowUpIcon className="size-3.5" />
	) : (
		<ArrowDownIcon className="size-3.5" />
	);
}

function PackagesTable({
	packages,
	sortField,
	sortDirection,
	onSort,
}: {
	packages: CondaPackage[];
	sortField: SortField;
	sortDirection: SortDirection;
	onSort: (field: SortField) => void;
}) {
	return (
		<div
			className="min-h-0 overflow-auto rounded-lg border"
			data-qa-id="environments-conda-detail-table"
		>
			<table className="w-full text-sm">
				<thead>
					<tr className="bg-muted/50 border-b">
						<th className="px-3 py-2.5 text-left font-medium">
							<button
								type="button"
								onClick={() => onSort("name")}
								className="inline-flex cursor-pointer items-center gap-1"
							>
								Package
								<SortIcon field="name" activeField={sortField} direction={sortDirection} />
							</button>
						</th>
						<th className="px-3 py-2.5 text-left font-medium">
							<button
								type="button"
								onClick={() => onSort("version")}
								className="inline-flex cursor-pointer items-center gap-1"
							>
								Version
								<SortIcon field="version" activeField={sortField} direction={sortDirection} />
							</button>
						</th>
						<th className="px-3 py-2.5 text-left font-medium">Actions</th>
					</tr>
				</thead>
				<tbody>
					{packages.map((pkg) => (
						<tr
							key={`${pkg.name}-${pkg.version}-${pkg.build}`}
							className="hover:bg-muted/30 border-b last:border-b-0"
							data-qa-id="environments-conda-detail-row"
						>
							<td className="px-3 py-2.5 font-medium">{pkg.name}</td>
							<td className="text-muted-foreground px-3 py-2.5">{pkg.version}</td>
							<td className="px-3 py-2.5">
								<Tooltip>
									<TooltipTrigger render={<span className="inline-flex" />}>
										<Button
											variant="ghost"
											size="icon-xs"
											disabled
											aria-label={`Actions for ${pkg.name}`}
										>
											<EllipsisVerticalIcon className="size-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>Soon</TooltipContent>
								</Tooltip>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function Pagination({
	page,
	totalPages,
	pageSize,
	rangeStart,
	rangeEnd,
	totalItems,
	onPageChange,
	onPageSizeChange,
}: {
	page: number;
	totalPages: number;
	pageSize: number;
	rangeStart: number;
	rangeEnd: number;
	totalItems: number;
	onPageChange: (page: number) => void;
	onPageSizeChange: (value: string | null) => void;
}) {
	const pageNumbers = useMemo(() => computePageNumbers(page, totalPages), [page, totalPages]);

	return (
		<div
			className="mt-3 flex items-center justify-between text-sm"
			data-qa-id="environments-conda-detail-pagination"
		>
			<div className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="icon-xs"
					disabled={page === 0}
					onClick={() => onPageChange(0)}
					aria-label="First page"
				>
					<ChevronsLeftIcon className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-xs"
					disabled={page === 0}
					onClick={() => onPageChange(page - 1)}
					aria-label="Previous page"
				>
					<ChevronLeftIcon className="size-4" />
				</Button>
				{pageNumbers.map((p, i) =>
					p === "ellipsis" ? (
						<span key={`ellipsis-${i}`} className="px-1">
							…
						</span>
					) : (
						<Button
							key={p}
							variant={p === page ? "default" : "ghost"}
							size="icon-xs"
							onClick={() => onPageChange(p)}
							aria-label={`Page ${p + 1}`}
							aria-current={p === page ? "page" : undefined}
						>
							{p + 1}
						</Button>
					),
				)}
				<Button
					variant="ghost"
					size="icon-xs"
					disabled={page >= totalPages - 1}
					onClick={() => onPageChange(page + 1)}
					aria-label="Next page"
				>
					<ChevronRightIcon className="size-4" />
				</Button>
				<Button
					variant="ghost"
					size="icon-xs"
					disabled={page >= totalPages - 1}
					onClick={() => onPageChange(totalPages - 1)}
					aria-label="Last page"
				>
					<ChevronsRightIcon className="size-4" />
				</Button>
			</div>

			<div className="flex items-center gap-3">
				<div className="flex items-center gap-2">
					<Select value={String(pageSize)} onValueChange={onPageSizeChange}>
						<SelectTrigger size="sm" className="w-16">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{PAGE_SIZES.map((size) => (
								<SelectItem key={size} value={String(size)}>
									{size}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<span className="text-muted-foreground">items per page</span>
				</div>
				<span className="text-muted-foreground">
					{rangeStart} - {rangeEnd} of {totalItems} items
				</span>
			</div>
		</div>
	);
}

function PackagesLoading() {
	return (
		<div className="space-y-3" data-qa-id="environments-conda-detail-loading">
			<Skeleton className="h-10 w-full rounded-lg" />
			<Skeleton className="h-10 w-full rounded-lg" />
			<Skeleton className="h-10 w-full rounded-lg" />
			<Skeleton className="h-10 w-full rounded-lg" />
			<Skeleton className="h-10 w-full rounded-lg" />
		</div>
	);
}
