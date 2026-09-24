import { useCallback, useMemo, useRef, useState } from "react";

import {
	ChevronLeftIcon,
	ArrowUpDownIcon,
	ArrowUpIcon,
	ArrowDownIcon,
	ArrowUpCircleIcon,
	ChevronDownIcon,
	FilterIcon,
	PlusIcon,
	TrashIcon,
	SearchIcon,
} from "lucide-react";

import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import { Input } from "@kilo-desktop/ui/components/input";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@kilo-desktop/ui/components/tooltip";
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { useSdk, useSdkQuery } from "@kilo-desktop/sdk-react";

import type {
	CondaEnv,
	CondaPackage,
	CondaRepodataFindResult,
	CondaService,
} from "../../../contracts/providers/conda.js";
import { AddPackageDialog } from "./AddPackageDialog.js";
import { BulkRemoveConfirmation } from "./BulkRemoveConfirmation.js";
import { compareCondaVersions } from "./compare-conda-versions.js";
import { ColumnResizer } from "./ColumnResizer.js";
import {
	MIN_COLUMN_WIDTH,
	readPackageTableColumnWidths,
	resizeColumn,
	writePackageTableColumnWidths,
	type PackageTableColumnId,
} from "./column-widths.js";
import { environmentDisplayName } from "./environment-display.js";
import { TablePagination } from "./TablePagination.js";
import { PackageRowActions } from "./PackageRowActions.js";
import { UpdateConfirmationDialog, type UpgradablePackage } from "./UpdateConfirmationDialog.js";

type SortField = "name" | "version" | "source" | "channel";
type SortDirection = "asc" | "desc";

function packageSource(pkg: CondaPackage): "pip" | "conda" {
	return pkg.channel === "pypi" ? "pip" : "conda";
}

interface EnvironmentDetailProps {
	env: CondaEnv;
	onBack: () => void;
}

const PAGE_SIZES = [20, 50, 100] as const;

/** Widths reserved for the pinned selection and row-actions columns. */
const SELECT_COLUMN_PX = 40;
const ACTIONS_COLUMN_PX = 80;

export function EnvironmentDetail({ env, onBack }: EnvironmentDetailProps) {
	const sdk = useSdk<CondaService>("environments");
	const displayName = environmentDisplayName(env);
	const packages = useSdkQuery(sdk, "conda.packages.list", {
		name: env.name || undefined,
		prefix: env.prefix,
	});

	// Fetch latest versions for installed conda packages to detect upgrades.
	// Pip packages are excluded (no conda repodata). Capped at 500 names.
	const condaPackageNames = useMemo(
		() => (packages.data?.packages ?? []).filter((p) => p.channel !== "pypi").map((p) => p.name),
		[packages.data?.packages],
	);

	// Query uses the installed package names when available, or a dummy
	// single-name that will return no results when there are no packages yet.
	// useSdkQuery doesn't support an `enabled` option, so we always call it.
	const repodataArgs = useMemo(
		() =>
			condaPackageNames.length > 0
				? { names: condaPackageNames.slice(0, 500), limit: 500 }
				: { names: ["__placeholder__"], limit: 1 },
		[condaPackageNames],
	);
	const repodata = useSdkQuery(sdk, "conda.repodata.find", repodataArgs);

	// Single-pass derivation of two related maps from repodata:
	//   - upgradableMap:        package name → newest available version
	//   - availableVersionsMap: package name → all versions newer than installed (newest first)
	// Built together so `upgradableMap.get(name) === availableVersionsMap.get(name)![0]`
	// by construction; the two consumers cannot drift apart. Bridge already
	// emits `versions` newest-first (see SidecarCondaBackend.ts and the
	// CondaRepodataPackage contract), so no re-sort is required.
	const { upgradableMap, availableVersionsMap } = useMemo(() => {
		const upgradable = new Map<string, string>();
		const available = new Map<string, string[]>();
		if (!repodata.data || !packages.data) {
			return { upgradableMap: upgradable, availableVersionsMap: available };
		}
		const repodataResult = repodata.data as CondaRepodataFindResult;
		const installedVersionByName = new Map(packages.data.packages.map((p) => [p.name, p.version]));
		for (const repoPkg of repodataResult.packages) {
			const installed = installedVersionByName.get(repoPkg.name);
			if (!installed) continue;
			const newer = repoPkg.versions
				.map((v) => v.version)
				.filter((v) => compareCondaVersions(v, installed) > 0);
			const [latest] = newer;
			if (latest !== undefined) {
				available.set(repoPkg.name, newer);
				upgradable.set(repoPkg.name, latest);
			}
		}
		return { upgradableMap: upgradable, availableVersionsMap: available };
	}, [repodata.data, packages.data]);

	const [search, setSearch] = useState("");
	const [sortField, setSortField] = useState<SortField>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
	const [page, setPage] = useState(0);
	const [pageSize, setPageSize] = useState<number>(20);
	const [showUpgradableOnly, setShowUpgradableOnly] = useState(false);

	// Selection state: tracks selected package names across pages
	const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
	const [showBulkRemove, setShowBulkRemove] = useState(false);
	const [showBulkUpdate, setShowBulkUpdate] = useState(false);
	const [showAddPackage, setShowAddPackage] = useState(false);
	const [showUpdateConfirmation, setShowUpdateConfirmation] = useState(false);
	// Package chosen via the per-row "Update…" action; opens the same
	// preview/backup sheet as the bulk paths with a single-item list.
	const [rowUpdatePackage, setRowUpdatePackage] = useState<CondaPackage | null>(null);
	// Tracks in-flight background updates from any UpdateConfirmationDialog
	// instance. Uses increment/decrement so concurrent jobs (row + bulk, or
	// two bulk operations) accumulate correctly instead of overwriting.
	const [updatingCount, setUpdatingCount] = useState(0);
	const bumpUpdating = useCallback(
		(delta: number) => setUpdatingCount((prev) => Math.max(0, prev + delta)),
		[],
	);

	const pythonVersion = useMemo(() => {
		const python = (packages.data?.packages ?? []).find((p) => p.name === "python");
		return python?.version ?? null;
	}, [packages.data?.packages]);

	const filtered = useMemo(() => {
		let list = packages.data?.packages ?? [];
		if (showUpgradableOnly) {
			list = list.filter((pkg) => upgradableMap.has(pkg.name));
		}
		const query = search.trim().toLowerCase();
		if (!query) return list;
		return list.filter((pkg) => pkg.name.toLowerCase().includes(query));
	}, [packages.data?.packages, search, showUpgradableOnly, upgradableMap]);

	const sorted = useMemo(() => {
		const items = [...filtered];
		items.sort((a, b) => {
			const aVal = sortField === "source" ? packageSource(a) : a[sortField].toLowerCase();
			const bVal = sortField === "source" ? packageSource(b) : b[sortField].toLowerCase();
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

	// Derive selected packages from the full filtered+sorted list
	const selectedPackages = useMemo(
		() => sorted.filter((pkg) => selectedNames.has(pkg.name)),
		[sorted, selectedNames],
	);

	// All selected packages for the bulk Update dialog.
	// Packages with no available update are included so the user sees them
	// in the dialog (marked as "up to date") instead of being silently dropped.
	const selectedForUpdate = useMemo(
		(): UpgradablePackage[] =>
			selectedPackages.map((pkg) => ({
				pkg,
				latestVersion: upgradableMap.get(pkg.name) ?? null,
				availableVersions: availableVersionsMap.get(pkg.name) ?? [],
			})),
		[selectedPackages, upgradableMap, availableVersionsMap],
	);

	const rowUpdateItems = useMemo(
		(): UpgradablePackage[] =>
			rowUpdatePackage
				? [
						{
							pkg: rowUpdatePackage,
							latestVersion: upgradableMap.get(rowUpdatePackage.name) ?? null,
							availableVersions: availableVersionsMap.get(rowUpdatePackage.name) ?? [],
						},
					]
				: [],
		[rowUpdatePackage, upgradableMap, availableVersionsMap],
	);

	// All upgradable packages (for the "Update all" action in the dropdown)
	const allUpgradable = useMemo(
		(): UpgradablePackage[] =>
			(packages.data?.packages ?? [])
				.filter((pkg) => upgradableMap.has(pkg.name))
				.map((pkg) => ({
					pkg,
					latestVersion: upgradableMap.get(pkg.name)!,
					// Safe: upgradableMap and availableVersionsMap are populated in
					// lockstep; if upgradableMap.has(name) then availableVersionsMap.has(name).
					availableVersions: availableVersionsMap.get(pkg.name)!,
				})),
		[packages.data?.packages, upgradableMap, availableVersionsMap],
	);

	// Whether all packages on the current page are selected
	const allPageSelected =
		paginatedPackages.length > 0 && paginatedPackages.every((pkg) => selectedNames.has(pkg.name));
	const somePageSelected =
		paginatedPackages.some((pkg) => selectedNames.has(pkg.name)) && !allPageSelected;

	const toggleSelectAll = useCallback(() => {
		setSelectedNames((prev) => {
			const next = new Set(prev);
			if (allPageSelected) {
				for (const pkg of paginatedPackages) next.delete(pkg.name);
			} else {
				for (const pkg of paginatedPackages) next.add(pkg.name);
			}
			return next;
		});
	}, [allPageSelected, paginatedPackages]);

	const toggleSelect = useCallback((name: string) => {
		setSelectedNames((prev) => {
			const next = new Set(prev);
			if (next.has(name)) {
				next.delete(name);
			} else {
				next.add(name);
			}
			return next;
		});
	}, []);

	function clearSelection() {
		setSelectedNames(new Set());
	}

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
			<div className="flex min-h-0 flex-1 flex-col gap-4" data-qa-id="environments-conda-detail">
				{/* Back button — top-left, above the header */}
				<button
					type="button"
					onClick={onBack}
					className="text-primary-ink flex cursor-pointer items-center gap-1 self-start text-sm font-medium hover:underline"
					data-qa-id="environments-conda-detail-back"
				>
					<ChevronLeftIcon className="size-4" />
					Back
				</button>

				{/* Header — matches the PageShell heading pattern used by other settings sections */}
				<header className="flex items-start justify-between gap-3">
					<div className="min-w-0">
						<div className="flex items-center gap-2.5">
							<h2
								className="text-base font-semibold tracking-tight"
								data-qa-id="environments-conda-detail-name"
							>
								{displayName}
							</h2>
							{pythonVersion && (
								<Badge
									className="bg-primary-soft text-primary-soft-foreground border-primary/20 shrink-0 border font-medium"
									data-qa-id="environments-conda-detail-python"
								>
									Python {pythonVersion}
								</Badge>
							)}
						</div>
						<div className="mt-1">
							<Tooltip>
								<TooltipTrigger
									render={
										<p
											className="text-muted-foreground cursor-default truncate font-mono text-xs"
											data-qa-id="environments-conda-detail-prefix"
										/>
									}
								>
									{env.prefix}
								</TooltipTrigger>
								<TooltipContent side="bottom" align="start">
									{env.prefix}
								</TooltipContent>
							</Tooltip>
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<Button
							variant="default"
							size="sm"
							onClick={() => setShowAddPackage(true)}
							data-qa-id="environments-conda-detail-add-pkg"
						>
							<PlusIcon data-icon="inline-start" className="size-4" />
							Package
						</Button>
					</div>
				</header>

				{/* Search + upgradable filter */}
				<div className="flex items-center gap-2">
					<div className="relative max-w-sm flex-1">
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
					{/* Update check indicator / Updates available dropdown */}
					{repodata.isPending && condaPackageNames.length > 0 && (
						<div className="text-muted-foreground flex items-center gap-2 text-sm">
							<Spinner size="sm" />
							Checking for updates…
						</div>
					)}
					{!repodata.isPending &&
						upgradableMap.size > 0 &&
						(updatingCount > 0 ? (
							<Button
								variant="outline"
								disabled
								data-qa-id="environments-conda-detail-upgradable-filter"
							>
								<Spinner size="sm" />
								Updating…
								<Badge variant="secondary">{updatingCount}</Badge>
							</Button>
						) : (
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											variant={showUpgradableOnly ? "default" : "outline"}
											data-qa-id="environments-conda-detail-upgradable-filter"
										/>
									}
								>
									<ArrowUpCircleIcon className="size-4" />
									Updates available
									<Badge variant={showUpgradableOnly ? "outline" : "secondary"}>
										{upgradableMap.size}
									</Badge>
									<ChevronDownIcon className="size-4" />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => setShowUpdateConfirmation(true)}>
										<ArrowUpCircleIcon className="size-4" />
										Update all…
									</DropdownMenuItem>
									<DropdownMenuItem
										onClick={() => {
											setShowUpgradableOnly((v) => !v);
											setPage(0);
										}}
									>
										<FilterIcon className="size-4" />
										{showUpgradableOnly ? "Show all packages" : "Filter packages with updates"}
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						))}
				</div>

				{/* Bulk action bar */}
				{selectedPackages.length > 0 && (
					<div
						className="bg-muted/50 flex items-center gap-2 rounded-lg border px-3 py-2"
						data-qa-id="environments-conda-detail-bulk-bar"
					>
						<span className="text-sm font-medium">
							{selectedPackages.length} {selectedPackages.length === 1 ? "package" : "packages"}{" "}
							selected
						</span>
						<Button
							variant="outline"
							size="sm"
							disabled={updatingCount > 0}
							onClick={() => setShowBulkUpdate(true)}
							data-qa-id="environments-conda-detail-bulk-update"
						>
							<ArrowUpCircleIcon className="size-4" />
							Update
						</Button>
						<Button
							variant="destructive"
							size="sm"
							onClick={() => setShowBulkRemove(true)}
							data-qa-id="environments-conda-detail-bulk-remove"
						>
							<TrashIcon className="size-4" />
							Remove
						</Button>
						<Button variant="ghost" size="sm" onClick={clearSelection}>
							Clear
						</Button>
					</div>
				)}

				{/* Bulk dialogs */}
				{showBulkRemove && (
					<BulkRemoveConfirmation
						env={env}
						packages={selectedPackages}
						open={showBulkRemove}
						onOpenChange={setShowBulkRemove}
						onSuccess={clearSelection}
					/>
				)}
				{showBulkUpdate && (
					<UpdateConfirmationDialog
						env={env}
						upgradablePackages={selectedForUpdate}
						open={showBulkUpdate}
						onClose={() => setShowBulkUpdate(false)}
						onSuccess={clearSelection}
						onUpdatingChange={bumpUpdating}
					/>
				)}
				{showUpdateConfirmation && (
					<UpdateConfirmationDialog
						env={env}
						upgradablePackages={allUpgradable}
						open={showUpdateConfirmation}
						onClose={() => setShowUpdateConfirmation(false)}
						onSuccess={clearSelection}
						onUpdatingChange={bumpUpdating}
					/>
				)}
				{rowUpdatePackage && (
					<UpdateConfirmationDialog
						env={env}
						upgradablePackages={rowUpdateItems}
						open
						onClose={() => setRowUpdatePackage(null)}
						onSuccess={() => {}}
						onUpdatingChange={bumpUpdating}
					/>
				)}

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
							env={env}
							packages={paginatedPackages}
							sortField={sortField}
							sortDirection={sortDirection}
							onSort={handleSort}
							selectedNames={selectedNames}
							allPageSelected={allPageSelected}
							somePageSelected={somePageSelected}
							onToggleSelectAll={toggleSelectAll}
							onToggleSelect={toggleSelect}
							upgradableMap={upgradableMap}
							onUpdatePackage={setRowUpdatePackage}
							updateDisabled={updatingCount > 0}
						/>
						<TablePagination
							pageIndex={safePage}
							pageCount={totalPages}
							onPageChange={setPage}
							rangeStart={rangeStart}
							rangeEnd={rangeEnd}
							totalItems={sorted.length}
							pageSize={pageSize}
							pageSizeOptions={PAGE_SIZES}
							onPageSizeChange={handlePageSizeChange}
							qaPrefix="environments-conda-detail-pagination"
							className="mt-3"
						/>
					</>
				)}
				{/* Add package sheet */}
				<AddPackageDialog
					env={env}
					open={showAddPackage}
					onClose={() => setShowAddPackage(false)}
				/>
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
	env,
	packages,
	sortField,
	sortDirection,
	onSort,
	selectedNames,
	allPageSelected,
	somePageSelected,
	onToggleSelectAll,
	onToggleSelect,
	upgradableMap,
	onUpdatePackage,
	updateDisabled,
}: {
	env: CondaEnv;
	packages: CondaPackage[];
	sortField: SortField;
	sortDirection: SortDirection;
	onSort: (field: SortField) => void;
	selectedNames: Set<string>;
	allPageSelected: boolean;
	somePageSelected: boolean;
	onToggleSelectAll: () => void;
	onToggleSelect: (name: string) => void;
	upgradableMap: Map<string, string>;
	onUpdatePackage: (pkg: CondaPackage) => void;
	/** Disable all per-row Update actions (e.g. while another update is in flight). */
	updateDisabled?: boolean;
}) {
	const tableWrapperRef = useRef<HTMLDivElement>(null);
	const [columnWidths, setColumnWidths] = useState(() => readPackageTableColumnWidths());
	// Mirrored in a ref so a drag resolves against the width it started from
	// without the pointer handlers closing over a stale render.
	const columnWidthsRef = useRef(columnWidths);
	columnWidthsRef.current = columnWidths;
	const handleColumnResize = useCallback(
		(column: PackageTableColumnId, nextWidthPx: number, options: { persist: boolean }) => {
			const current = columnWidthsRef.current;
			// Cap the drag so "Channel" keeps its minimum: the row must total its
			// container, never overflow it sideways.
			const available = tableWrapperRef.current?.clientWidth ?? Number.POSITIVE_INFINITY;
			const others = (Object.keys(current) as PackageTableColumnId[])
				.filter((id) => id !== column)
				.reduce((total, id) => total + current[id], 0);
			const maxWidth = available - others - SELECT_COLUMN_PX - ACTIONS_COLUMN_PX - MIN_COLUMN_WIDTH;
			const next = resizeColumn(
				current,
				column,
				nextWidthPx - current[column],
				MIN_COLUMN_WIDTH,
				maxWidth,
			);
			columnWidthsRef.current = next;
			setColumnWidths(next);
			if (options.persist) writePackageTableColumnWidths(next);
		},
		[],
	);

	return (
		<div
			className="min-h-0 overflow-auto rounded-lg border"
			data-qa-id="environments-conda-detail-table"
			ref={tableWrapperRef}
		>
			{/* table-fixed so the colgroup below, not the content, decides widths. */}
			<table className="w-full table-fixed text-sm">
				<colgroup>
					<col style={{ width: `${SELECT_COLUMN_PX}px` }} />
					{/*
					 * min() caps each stored width against a share of the table, so a
					 * narrow window can never push the row wider than its container.
					 */}
					<col style={{ width: `min(${columnWidths.name}px, 35%)` }} />
					<col style={{ width: `min(${columnWidths.version}px, 20%)` }} />
					<col style={{ width: `min(${columnWidths.source}px, 20%)` }} />
					{/* No width: "Channel" absorbs whatever is left over. */}
					<col />
					<col style={{ width: `${ACTIONS_COLUMN_PX}px` }} />
				</colgroup>
				<thead className="bg-background sticky top-0 z-10">
					<tr className="bg-muted/50 border-b">
						<th className="w-10 px-3 py-2.5">
							<Checkbox
								checked={allPageSelected}
								indeterminate={somePageSelected}
								onCheckedChange={onToggleSelectAll}
								aria-label="Select all packages on this page"
								data-qa-id="environments-conda-detail-select-all"
							/>
						</th>
						<th className="relative px-3 py-2.5 text-left font-medium">
							<button
								type="button"
								onClick={() => onSort("name")}
								className="inline-flex cursor-pointer items-center gap-1"
							>
								Package
								<SortIcon field="name" activeField={sortField} direction={sortDirection} />
							</button>
							<ColumnResizer
								label="Package"
								width={columnWidths.name}
								minWidth={MIN_COLUMN_WIDTH}
								qaId="environments-detail-column-resizer-name"
								onResize={(next, options) => handleColumnResize("name", next, options)}
							/>
						</th>
						<th className="relative px-3 py-2.5 text-left font-medium">
							<button
								type="button"
								onClick={() => onSort("version")}
								className="inline-flex cursor-pointer items-center gap-1"
							>
								Version
								<SortIcon field="version" activeField={sortField} direction={sortDirection} />
							</button>
							<ColumnResizer
								label="Version"
								width={columnWidths.version}
								minWidth={MIN_COLUMN_WIDTH}
								qaId="environments-detail-column-resizer-version"
								onResize={(next, options) => handleColumnResize("version", next, options)}
							/>
						</th>
						<th className="relative px-3 py-2.5 text-left font-medium">
							<button
								type="button"
								onClick={() => onSort("source")}
								className="inline-flex cursor-pointer items-center gap-1"
							>
								Source
								<SortIcon field="source" activeField={sortField} direction={sortDirection} />
							</button>
							<ColumnResizer
								label="Source"
								width={columnWidths.source}
								minWidth={MIN_COLUMN_WIDTH}
								qaId="environments-detail-column-resizer-source"
								onResize={(next, options) => handleColumnResize("source", next, options)}
							/>
						</th>
						<th className="px-3 py-2.5 text-left font-medium">
							<button
								type="button"
								onClick={() => onSort("channel")}
								className="inline-flex cursor-pointer items-center gap-1"
							>
								Channel
								<SortIcon field="channel" activeField={sortField} direction={sortDirection} />
							</button>
						</th>
						<th className="px-3 py-2.5 text-left font-medium">Actions</th>
					</tr>
				</thead>
				<tbody>
					{packages.map((pkg) => {
						const isSelected = selectedNames.has(pkg.name);
						const latestVersion = upgradableMap.get(pkg.name);
						return (
							<tr
								key={`${pkg.name}-${pkg.version}-${pkg.build}`}
								className={`hover:bg-muted/30 border-b last:border-b-0 ${isSelected ? "bg-muted/20" : ""}`}
								data-qa-id="environments-conda-detail-row"
							>
								<td className="px-3 py-2.5">
									<Checkbox
										checked={isSelected}
										onCheckedChange={() => onToggleSelect(pkg.name)}
										aria-label={`Select ${pkg.name}`}
									/>
								</td>
								<td className="truncate px-3 py-2.5 font-medium">{pkg.name}</td>
								<td className="px-3 py-2.5">
									<div className="flex items-center gap-1.5">
										{latestVersion && (
											<Tooltip>
												<TooltipTrigger
													render={
														<span
															className="text-primary-ink inline-flex cursor-default items-center"
															aria-label={`Update available: ${pkg.version} → ${latestVersion}`}
															data-qa-id="environments-conda-detail-upgrade-badge"
														/>
													}
												>
													<ArrowUpCircleIcon className="size-3.5" />
												</TooltipTrigger>
												<TooltipContent>
													Update available: {pkg.version} → {latestVersion}
												</TooltipContent>
											</Tooltip>
										)}
										<span className="text-muted-foreground truncate">{pkg.version}</span>
									</div>
								</td>
								<td className="px-3 py-2.5">
									<SourceBadge source={packageSource(pkg)} channel={pkg.channel} />
								</td>
								<td
									className="text-muted-foreground px-3 py-2.5"
									data-qa-id="environments-conda-detail-channel"
								>
									<span className="truncate">{pkg.channel}</span>
								</td>
								<td className="px-3 py-2.5">
									<PackageRowActions
										env={env}
										pkg={pkg}
										hasUpdate={!updateDisabled && upgradableMap.has(pkg.name)}
										onUpdate={onUpdatePackage}
									/>
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</div>
	);
}

function SourceBadge({ source, channel }: { source: "pip" | "conda"; channel: string }) {
	const isPip = source === "pip";
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<span
						className={`inline-flex cursor-default items-center rounded-full px-2 py-0.5 text-xs font-medium ${
							isPip
								? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
								: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
						}`}
						data-qa-id="environments-conda-detail-source"
					/>
				}
			>
				{isPip ? "pip" : "conda"}
			</TooltipTrigger>
			<TooltipContent side="bottom" align="start">
				{isPip ? "Installed via pip (PyPI)" : `Channel: ${channel}`}
			</TooltipContent>
		</Tooltip>
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
