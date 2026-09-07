import { useState, useMemo, useCallback, useSyncExternalStore } from "react";

import { useSdk, useSdkQuery } from "@anaconda-agentic-desktop/sdk-react";
import { Input } from "@anaconda-agentic-desktop/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@anaconda-agentic-desktop/ui/components/select";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@anaconda-agentic-desktop/ui/components/dropdown-menu";
import { Spinner } from "@anaconda-agentic-desktop/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@anaconda-agentic-desktop/ui/components/tooltip";
import {
	ArrowDownIcon,
	ArrowUpIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	ChevronsLeftIcon,
	ChevronsRightIcon,
	CopyIcon,
	EllipsisVerticalIcon,
	FileUpIcon,
	PlusIcon,
	SearchIcon,
	TrashIcon,
} from "lucide-react";

import type { CondaEnv, CondaService } from "../../../contracts/providers/conda.js";
import { CloneEnvironmentDialog } from "./CloneEnvironmentDialog.js";
import { CreateEnvironmentDialog } from "./CreateEnvironmentDialog.js";
import { DeleteEnvironmentDialog } from "./DeleteEnvironmentDialog.js";
import { EnvironmentDetail } from "./EnvironmentDetail.js";
import { ImportEnvironmentDialog } from "./ImportEnvironmentDialog.js";
import { environmentDisplayName } from "./environment-display.js";

const PAGE_SIZE_OPTIONS = [
	{ value: "10", label: "10" },
	{ value: "15", label: "15" },
	{ value: "30", label: "30" },
	{ value: "50", label: "50" },
	{ value: "100", label: "100" },
];

/**
 * Renderer panel for the conda provider's Environments tab.
 *
 * Reads `conda.envs.list` via `useSdkQuery` (see `packages/sdk-react`),
 * which pipes through the plugin's `mainRegister` handler and, in
 * production, calls `conda env list --json` inside the plugin-scoped base.
 *
 * Features: search (name + prefix), alphabetical sort via column header,
 * and configurable pagination. All processing is client-side since the
 * full dataset is fetched in a single RPC call.
 *
 * Clicking an environment row opens the detail view, which shows the
 * installed packages for that environment. The "Back" button returns to
 * the list.
 *
 * Layout follows the Anaconda Desktop table pattern: search bar, item
 * count, data table with sortable headers, and a pagination bar.
 *
 * The panel uses `data-qa-id` attributes for browser and e2e tests
 * following the repo convention (see `docs/TESTING.md`).
 */
/**
 * Read the `env` search param from the shell location. When a user selects
 * an environment, we navigate to `?env=<prefix>` via `sdk.navigate`; going
 * back clears the param. This keeps TanStack Router's history tracking
 * intact — no raw `window.history.pushState` that clobbers `__TSR_index`.
 */
function useSelectedPrefix(sdk: ReturnType<typeof useSdk<CondaService>>): string | undefined {
	const subscribe = useCallback((fn: () => void) => sdk.location.subscribe(fn), [sdk]);
	const getSnapshot = useCallback(() => {
		const env = sdk.location.peek().search.env;
		return typeof env === "string" && env ? env : undefined;
	}, [sdk]);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function EnvironmentsPanel() {
	const sdk = useSdk<CondaService>("environments");
	const envs = useSdkQuery(sdk, "conda.envs.list");
	const selectedPrefix = useSelectedPrefix(sdk);

	const selectEnv = useCallback(
		(env: CondaEnv) => {
			const currentPath = sdk.location.peek().path;
			sdk.navigate(currentPath, { search: { env: env.prefix } });
		},
		[sdk],
	);

	const goBack = useCallback(() => {
		const currentPath = sdk.location.peek().path;
		sdk.navigate(currentPath, { search: {} });
	}, [sdk]);

	// Resolve the CondaEnv object from the prefix in the search param.
	const selectedEnv = useMemo(() => {
		if (!selectedPrefix || !envs.data) return null;
		return envs.data.find((e) => e.prefix === selectedPrefix) ?? null;
	}, [selectedPrefix, envs.data]);

	if (selectedEnv) {
		return <EnvironmentDetail env={selectedEnv} onBack={goBack} />;
	}

	if (envs.isPending) {
		return (
			<div
				className="flex min-h-64 flex-col items-center justify-center gap-4"
				data-qa-id="environments-conda-loading"
			>
				<Spinner size="md" className="text-primary" label="Loading environments" />
				<p className="text-muted-foreground text-sm">Loading environments…</p>
			</div>
		);
	}

	if (envs.isError) {
		return (
			<p className="text-destructive text-sm" role="alert" data-qa-id="environments-conda-error">
				Could not load environments: {envs.error.message}
			</p>
		);
	}

	const rows = envs.data ?? [];

	if (rows.length === 0) {
		return (
			<p className="text-muted-foreground text-sm" data-qa-id="environments-conda-empty">
				No conda environments found.
			</p>
		);
	}

	return <EnvironmentsTable rows={rows} onSelectEnv={selectEnv} />;
}

type DialogState =
	| { kind: "none" }
	| { kind: "create" }
	| { kind: "import" }
	| { kind: "clone"; env: CondaEnv }
	| { kind: "delete"; env: CondaEnv };

/** Nameless envs: base installs and prefix-only envs both have `name: ""`. */
function isNamelessEnv(env: CondaEnv): boolean {
	return env.name === "";
}

interface EnvironmentsTableProps {
	rows: Array<{ name: string; prefix: string }>;
	onSelectEnv: (env: CondaEnv) => void;
}

function EnvironmentsTable({ rows, onSelectEnv }: EnvironmentsTableProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");
	const [currentPage, setCurrentPage] = useState(1);
	const [itemsPerPage, setItemsPerPage] = useState(15);
	const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
	const closeDialog = useCallback(() => setDialog({ kind: "none" }), []);

	const processedEnvs = useMemo(() => {
		let result = [...rows];

		if (searchQuery) {
			const query = searchQuery.toLowerCase();
			result = result.filter(
				(env) =>
					environmentDisplayName(env).toLowerCase().includes(query) ||
					env.prefix.toLowerCase().includes(query),
			);
		}

		result.sort((a, b) => {
			const nameA = environmentDisplayName(a);
			const nameB = environmentDisplayName(b);
			const comparison = nameA.localeCompare(nameB);
			return sortOrder === "asc" ? comparison : -comparison;
		});

		return result;
	}, [rows, searchQuery, sortOrder]);

	const totalItems = processedEnvs.length;
	const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
	// Clamp currentPage if the dataset shrinks (e.g. rows prop changes
	// externally without going through one of our handlers).
	const effectivePage = Math.min(currentPage, totalPages);
	const startIndex = (effectivePage - 1) * itemsPerPage;
	const paginatedEnvs = processedEnvs.slice(startIndex, startIndex + itemsPerPage);

	const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		setSearchQuery(e.target.value);
		setCurrentPage(1);
	};

	const handleSortToggle = () => {
		setSortOrder(sortOrder === "asc" ? "desc" : "asc");
		setCurrentPage(1);
	};

	const handleItemsPerPageChange = (value: string | null) => {
		if (value == null) return;
		setItemsPerPage(Number(value));
		setCurrentPage(1);
	};

	const goToPage = (page: number) => {
		const clamped = Math.max(1, Math.min(page, totalPages));
		setCurrentPage(clamped);
	};

	const pageNumbers = useMemo(() => {
		const pages: number[] = [];
		const maxVisible = 5;
		let start = Math.max(1, effectivePage - Math.floor(maxVisible / 2));
		const end = Math.min(totalPages, start + maxVisible - 1);
		start = Math.max(1, end - maxVisible + 1);
		for (let i = start; i <= end; i++) {
			pages.push(i);
		}
		return pages;
	}, [effectivePage, totalPages]);

	return (
		<TooltipProvider>
			<div className="flex min-h-0 flex-1 flex-col gap-4" data-qa-id="environments-controls">
				{/* Toolbar: search + action buttons */}
				<div className="flex items-center gap-3">
					<div className="relative flex-1">
						<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
						<Input
							id="environments-search"
							placeholder="Search"
							value={searchQuery}
							onChange={handleSearchChange}
							className="pl-9"
							data-qa-id="environments-search-input"
						/>
					</div>
					<div className="flex items-center gap-2">
						<Button
							size="sm"
							onClick={() => setDialog({ kind: "create" })}
							data-qa-id="environments-create-btn"
						>
							<PlusIcon className="size-4" />
							New environment
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => setDialog({ kind: "import" })}
							data-qa-id="environments-import-btn"
						>
							<FileUpIcon className="size-4" />
							Import from file
						</Button>
					</div>
				</div>

				{/* Item count */}
				<div className="text-muted-foreground text-sm" data-qa-id="environments-results-info">
					{totalItems} {totalItems === 1 ? "item" : "items"}
				</div>

				{/* Table */}
				{paginatedEnvs.length === 0 ? (
					<p
						className="text-muted-foreground text-sm"
						data-qa-id="environments-conda-empty-filtered"
					>
						No conda environments match the current filters.
					</p>
				) : (
					<div className="min-h-0 overflow-auto rounded-lg border">
						<table className="w-full table-fixed border-separate border-spacing-0">
							<caption className="sr-only">Conda environments</caption>
							<thead className="bg-background sticky top-0 z-10">
								<tr>
									{/*
									 * `aria-sort` on the th (not the button) is what assistive tech
									 * reads for sort state; the icon alone is invisible to it.
									 */}
									<th
										scope="col"
										aria-sort={sortOrder === "asc" ? "ascending" : "descending"}
										className="border-b p-0 text-left text-sm font-medium"
									>
										<button
											type="button"
											className="hover:bg-foreground/5 flex w-full items-center gap-1 px-4 py-3 text-left transition-colors"
											onClick={handleSortToggle}
											data-qa-id="environments-sort-toggle"
										>
											Name
											{sortOrder === "asc" ? (
												<ArrowDownIcon className="size-3.5" aria-hidden="true" />
											) : (
												<ArrowUpIcon className="size-3.5" aria-hidden="true" />
											)}
											<span className="sr-only">
												{sortOrder === "asc" ? "sorted ascending" : "sorted descending"}
											</span>
										</button>
									</th>
									<th
										scope="col"
										className="text-muted-foreground border-b px-4 py-3 text-left text-sm font-medium"
									>
										Prefix
									</th>
									<th
										scope="col"
										className="border-b px-4 py-3 text-right text-sm font-medium"
										style={{ width: "3.5rem" }}
									>
										<span className="sr-only">Actions</span>
									</th>
								</tr>
							</thead>
							<tbody>
								{paginatedEnvs.map((env) => (
									<tr
										key={env.prefix}
										role="button"
										tabIndex={0}
										className="hover:bg-foreground/10 group cursor-pointer transition-colors"
										data-qa-id="environments-conda-row"
										onClick={() => onSelectEnv(env)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												onSelectEnv(env);
											}
										}}
									>
										<td
											className="border-b px-4 py-3 font-medium group-last:border-b-0"
											data-qa-id="environments-conda-name"
										>
											{environmentDisplayName(env)}
										</td>
										<td
											className="text-muted-foreground border-b px-4 py-3 font-mono text-sm group-last:border-b-0"
											data-qa-id="environments-conda-prefix"
										>
											<Tooltip>
												<TooltipTrigger render={<span className="block cursor-default truncate" />}>
													{env.prefix}
												</TooltipTrigger>
												<TooltipContent side="bottom" align="start">
													{env.prefix}
												</TooltipContent>
											</Tooltip>
										</td>
										<td
											className="border-b px-4 py-3 text-right group-last:border-b-0"
											onClick={(e) => e.stopPropagation()}
											onKeyDown={(e) => e.stopPropagation()}
										>
											<DropdownMenu>
												<DropdownMenuTrigger
													render={
														<Button
															variant="ghost"
															size="icon-sm"
															aria-label={`Actions for ${environmentDisplayName(env)}`}
															data-qa-id="environments-row-actions"
														/>
													}
												>
													<EllipsisVerticalIcon className="size-4" />
												</DropdownMenuTrigger>
												<DropdownMenuContent align="end">
													{!isNamelessEnv(env) && (
														<DropdownMenuItem
															onClick={() => setDialog({ kind: "clone", env })}
															data-qa-id="environments-row-clone"
														>
															<CopyIcon className="size-4" />
															Clone
														</DropdownMenuItem>
													)}
													{!isNamelessEnv(env) && (
														<DropdownMenuItem
															variant="destructive"
															onClick={() => setDialog({ kind: "delete", env })}
															data-qa-id="environments-row-delete"
														>
															<TrashIcon className="size-4" />
															Delete
														</DropdownMenuItem>
													)}
													{isNamelessEnv(env) && (
														<DropdownMenuItem disabled>No actions available</DropdownMenuItem>
													)}
												</DropdownMenuContent>
											</DropdownMenu>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}

				{/*
				 * Hidden when the filters match nothing: a pager over an empty result
				 * set would render a nonsensical "1 – 0 of 0 items" range.
				 */}
				{totalItems > 0 && (
					<div
						className="flex items-center justify-between gap-4"
						data-qa-id="environments-pagination"
					>
						{/* Page navigation */}
						<div className="flex items-center gap-1">
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => goToPage(1)}
								disabled={effectivePage === 1}
								aria-label="First page"
							>
								<ChevronsLeftIcon className="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => goToPage(effectivePage - 1)}
								disabled={effectivePage === 1}
								data-qa-id="environments-pagination-prev"
								aria-label="Previous page"
							>
								<ChevronLeftIcon className="size-4" />
							</Button>

							{pageNumbers.map((page) => (
								<Button
									key={page}
									variant={page === effectivePage ? "default" : "ghost"}
									size="sm"
									onClick={() => goToPage(page)}
									className="min-w-8"
								>
									{page}
								</Button>
							))}

							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => goToPage(effectivePage + 1)}
								disabled={effectivePage === totalPages}
								data-qa-id="environments-pagination-next"
								aria-label="Next page"
							>
								<ChevronRightIcon className="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								onClick={() => goToPage(totalPages)}
								disabled={effectivePage === totalPages}
								aria-label="Last page"
							>
								<ChevronsRightIcon className="size-4" />
							</Button>
						</div>

						{/* Items per page + range indicator */}
						<div className="flex items-center gap-3">
							<Select value={String(itemsPerPage)} onValueChange={handleItemsPerPageChange}>
								<SelectTrigger className="w-16" data-qa-id="environments-items-per-page">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{PAGE_SIZE_OPTIONS.map((opt) => (
										<SelectItem key={opt.value} value={opt.value}>
											{opt.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<span className="text-muted-foreground text-sm whitespace-nowrap">
								items per page
							</span>
							<span className="text-muted-foreground text-sm whitespace-nowrap">
								{startIndex + 1} – {Math.min(startIndex + itemsPerPage, totalItems)} of {totalItems}{" "}
								items
							</span>
						</div>
					</div>
				)}
				{/* Dialogs */}
				<CreateEnvironmentDialog open={dialog.kind === "create"} onClose={closeDialog} />
				<ImportEnvironmentDialog open={dialog.kind === "import"} onClose={closeDialog} />
				{dialog.kind === "clone" && (
					<CloneEnvironmentDialog env={dialog.env} open onClose={closeDialog} />
				)}
				{dialog.kind === "delete" && (
					<DeleteEnvironmentDialog env={dialog.env} open onClose={closeDialog} />
				)}
			</div>
		</TooltipProvider>
	);
}
