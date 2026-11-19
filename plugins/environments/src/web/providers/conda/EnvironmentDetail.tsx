import { useRef, useState, type ReactNode, type RefObject } from "react";

import { useVirtualizer } from "@tanstack/react-virtual";
import {
	ArrowLeftIcon,
	CircleAlertIcon,
	CopyIcon,
	EllipsisIcon,
	PackageIcon,
	PlusIcon,
	RefreshCwIcon,
	SearchIcon,
	SearchXIcon,
	Trash2Icon,
} from "lucide-react";

import { SettingsPageHeader } from "@kilo-desktop/ui/components/settings-page-header";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@kilo-desktop/ui/components/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@kilo-desktop/ui/components/input-group";
import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kilo-desktop/ui/components/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import type {
	CondaEnv,
	CondaPackage,
	CondaRepodataFindResult,
} from "../../../contracts/providers/conda";
import { useConda, useCondaQuery } from "../../conda";
import { ToolbarSkeleton } from "../../EnvironmentsListSkeleton";
import { AddPackageDialog } from "./AddPackageDialog";
import { BulkRemoveConfirmation } from "./BulkRemoveConfirmation";
import { CloneEnvironmentDialog } from "./CloneEnvironmentDialog";
import { compareCondaVersions } from "./compare-conda-versions";
import { DeleteEnvironmentDialog } from "./DeleteEnvironmentDialog";
import { environmentDisplayName } from "./environment-display";
import { ListViewMenu, type SortDirection } from "./ListViewMenu";
import { PackageRowActions } from "./PackageRowActions";
import { UpdateIcon } from "./package-change-icons";
import {
	packagesLabel,
	UpdateConfirmationDialog,
	type UpgradablePackage,
} from "./UpdateConfirmationDialog";

type SortField = "name" | "version" | "source" | "channel";

const SORT_FIELDS = [
	{ value: "name", label: "Name" },
	{ value: "version", label: "Version" },
	{ value: "source", label: "Source" },
	{ value: "channel", label: "Channel" },
] as const;

/**
 * Estimated row height (a 28px row-actions button + cell padding + border);
 * rows are measured once rendered.
 */
const ROW_ESTIMATE_PX = 45;
const ROW_OVERSCAN = 12;

function packageSource(pkg: CondaPackage): "pip" | "conda" {
	return pkg.channel === "pypi" ? "pip" : "conda";
}

interface Upgrades {
	/** Package name → newest available version. */
	upgradableMap: Map<string, string>;
	/** Package name → all versions newer than installed (newest first). */
	availableVersionsMap: Map<string, string[]>;
}

/**
 * Single-pass derivation of both upgrade maps from repodata, built together so
 * `upgradableMap.get(name) === availableVersionsMap.get(name)![0]` by
 * construction; the two consumers cannot drift apart. Bridge already emits
 * `versions` newest-first (see SidecarCondaBackend.ts and the
 * CondaRepodataPackage contract), so no re-sort is required.
 */
function deriveUpgrades(
	repodata: CondaRepodataFindResult | undefined,
	installedPackages: readonly CondaPackage[],
): Upgrades {
	const upgradableMap = new Map<string, string>();
	const availableVersionsMap = new Map<string, string[]>();
	if (!repodata) return { upgradableMap, availableVersionsMap };
	const installedVersionByName = new Map(installedPackages.map((p) => [p.name, p.version]));
	for (const repoPkg of repodata.packages) {
		const installed = installedVersionByName.get(repoPkg.name);
		if (!installed) continue;
		const newer = repoPkg.versions
			.map((v) => v.version)
			.filter((v) => compareCondaVersions(v, installed) > 0);
		const [latest] = newer;
		if (latest !== undefined) {
			availableVersionsMap.set(repoPkg.name, newer);
			upgradableMap.set(repoPkg.name, latest);
		}
	}
	return { upgradableMap, availableVersionsMap };
}

function visiblePackages(
	installed: readonly CondaPackage[],
	view: {
		search: string;
		showUpgradableOnly: boolean;
		upgradableMap: ReadonlyMap<string, string>;
		sortField: SortField;
		sortDirection: SortDirection;
	},
): CondaPackage[] {
	const query = view.search.trim().toLowerCase();
	const field = view.sortField;
	return installed
		.filter(
			(pkg) =>
				(!view.showUpgradableOnly || view.upgradableMap.has(pkg.name)) &&
				(!query || pkg.name.toLowerCase().includes(query)),
		)
		.toSorted((a, b) => {
			const aVal = field === "source" ? packageSource(a) : a[field].toLowerCase();
			const bVal = field === "source" ? packageSource(b) : b[field].toLowerCase();
			const cmp = aVal.localeCompare(bVal);
			return view.sortDirection === "asc" ? cmp : -cmp;
		});
}

function selectedOf(
	packages: readonly CondaPackage[],
	selectedNames: ReadonlySet<string>,
): CondaPackage[] {
	return packages.filter((pkg) => selectedNames.has(pkg.name));
}

function upgradableOf(
	packages: readonly CondaPackage[],
	upgradableMap: ReadonlyMap<string, string>,
): CondaPackage[] {
	return packages.filter((pkg) => upgradableMap.has(pkg.name));
}

function toUpgradables(packages: readonly CondaPackage[], upgrades: Upgrades): UpgradablePackage[] {
	return packages.map((pkg) => ({
		pkg,
		latestVersion: upgrades.upgradableMap.get(pkg.name) ?? null,
		availableVersions: upgrades.availableVersionsMap.get(pkg.name) ?? [],
	}));
}

type EnvironmentDialog =
	| "none"
	| "add"
	| "update-all"
	| "bulk-update"
	| "bulk-remove"
	| "clone"
	| "delete";

interface EnvironmentDetailProps {
	env: CondaEnv;
	onBack: () => void;
}

export function EnvironmentDetail({ env, onBack }: EnvironmentDetailProps) {
	const conda = useConda();
	const packages = useCondaQuery(conda, "listPackages", {
		name: env.name || undefined,
		prefix: env.prefix,
	});
	const installed = packages.data?.packages ?? [];
	const { upgrades, allUpgradable, checkingUpdates } = usePackageUpgrades(conda, installed);
	const { upgradableMap } = upgrades;

	const [search, setSearch] = useState("");
	const [sortField, setSortField] = useState<SortField>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
	const [showUpgradableOnly, setShowUpgradableOnly] = useState(false);
	const [dialog, setDialog] = useState<EnvironmentDialog>("none");
	// Package chosen via the per-row "Update…" action; opens the same
	// preview/backup sheet as the bulk paths with a single-item list.
	const [rowUpdatePackage, setRowUpdatePackage] = useState<CondaPackage | null>(null);
	// Tracks in-flight background updates from any UpdateConfirmationDialog
	// instance. Uses increment/decrement so concurrent jobs (row + bulk, or
	// two bulk operations) accumulate correctly instead of overwriting.
	const [updatingCount, setUpdatingCount] = useState(0);

	const visible = visiblePackages(installed, {
		search,
		showUpgradableOnly,
		upgradableMap,
		sortField,
		sortDirection,
	});
	// Selection lives in its own hook so `visible` is frozen before selection
	// reads it: toggling a checkbox must not re-filter and re-sort the list.
	const {
		selectedNames,
		selectedPackages,
		allSelected,
		someSelected,
		toggleSelect,
		toggleSelectAll,
		clearSelection,
	} = usePackageSelection(visible);

	const displayName = environmentDisplayName(env);
	const closeDialog = () => setDialog("none");
	const bumpUpdating = (delta: number) => setUpdatingCount((prev) => Math.max(0, prev + delta));
	const pythonVersion = installed.find((p) => p.name === "python")?.version ?? null;

	// Packages with no available update are included so the user sees them in
	// the dialog (marked "up to date") instead of being silently dropped.
	const selectedForUpdate = toUpgradables(selectedPackages, upgrades);
	const rowUpdateItems = rowUpdatePackage ? toUpgradables([rowUpdatePackage], upgrades) : [];
	const hasFilters = search.trim() !== "" || showUpgradableOnly;

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-6" data-qa-id="environments-conda-detail">
			<DetailHeading
				displayName={displayName}
				prefix={env.prefix}
				onBack={onBack}
				actions={
					<>
						{checkingUpdates ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled
								data-qa-id="environments-conda-detail-update-all"
							>
								<Spinner data-icon="inline-start" aria-hidden="true" />
								Checking for updates…
							</Button>
						) : updatingCount > 0 ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled
								data-qa-id="environments-conda-detail-update-all"
							>
								<Spinner data-icon="inline-start" aria-hidden="true" />
								Updating…
							</Button>
						) : allUpgradable.length > 0 ? (
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={() => setDialog("update-all")}
								data-qa-id="environments-conda-detail-update-all"
							>
								<UpdateIcon data-icon="inline-start" aria-hidden="true" />
								Update {packagesLabel(allUpgradable.length)}
							</Button>
						) : null}
						<Button
							type="button"
							size="sm"
							onClick={() => setDialog("add")}
							data-qa-id="environments-conda-detail-add-pkg"
						>
							<PlusIcon data-icon="inline-start" aria-hidden="true" />
							Add packages
						</Button>
						{env.name ? (
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button
											type="button"
											variant="ghost"
											size="icon-sm"
											aria-label={`More actions for ${displayName}`}
											data-qa-id="environments-conda-detail-actions"
										/>
									}
								>
									<EllipsisIcon />
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									<DropdownMenuItem onClick={() => setDialog("clone")}>
										<CopyIcon />
										Clone
									</DropdownMenuItem>
									<DropdownMenuItem variant="destructive" onClick={() => setDialog("delete")}>
										<Trash2Icon />
										Delete
									</DropdownMenuItem>
								</DropdownMenuContent>
							</DropdownMenu>
						) : null}
					</>
				}
			>
				{pythonVersion ? (
					<Badge variant="secondary" data-qa-id="environments-conda-detail-python">
						Python {pythonVersion}
					</Badge>
				) : null}
			</DetailHeading>

			<div className="flex min-h-0 flex-1 flex-col gap-4">
				{selectedPackages.length > 0 ? (
					<div
						className="flex h-8 shrink-0 items-center gap-2"
						data-qa-id="environments-conda-detail-bulk-bar"
					>
						<span className="text-sm font-medium" aria-live="polite">
							{selectedPackages.length} selected
						</span>
						<Button
							type="button"
							variant="outline"
							size="sm"
							disabled={updatingCount > 0}
							onClick={() => setDialog("bulk-update")}
							data-qa-id="environments-conda-detail-bulk-update"
						>
							<UpdateIcon data-icon="inline-start" aria-hidden="true" />
							Update
						</Button>
						<Button
							type="button"
							variant="destructive"
							size="sm"
							onClick={() => setDialog("bulk-remove")}
							data-qa-id="environments-conda-detail-bulk-remove"
						>
							<Trash2Icon data-icon="inline-start" aria-hidden="true" />
							Remove
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							className="ml-auto"
							onClick={clearSelection}
						>
							Clear
						</Button>
					</div>
				) : (
					<div className="flex shrink-0 items-center gap-2">
						<InputGroup size="sm" className="min-w-40 flex-1">
							<InputGroupInput
								type="search"
								value={search}
								onChange={(event) => setSearch(event.currentTarget.value)}
								placeholder="Search packages"
								aria-label="Search packages"
								data-qa-id="environments-conda-detail-search"
							/>
							<InputGroupAddon>
								<SearchIcon aria-hidden="true" />
							</InputGroupAddon>
						</InputGroup>
						<ListViewMenu
							label="Sort and filter packages"
							fields={SORT_FIELDS}
							field={sortField}
							direction={sortDirection}
							onFieldChange={setSortField}
							onDirectionChange={setSortDirection}
							filters={
								upgradableMap.size > 0
									? [
											{
												id: "upgradable",
												label: "Only packages with updates",
												checked: showUpgradableOnly,
												onCheckedChange: setShowUpgradableOnly,
											},
										]
									: []
							}
							qaId="environments-conda-detail-view-menu"
						/>
					</div>
				)}

				{packages.isPending ? (
					<PackagesLoading />
				) : packages.isError ? (
					<Empty className="border" data-qa-id="environments-conda-detail-error">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<CircleAlertIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>Could not load packages</EmptyTitle>
							<EmptyDescription>{packages.error.message}</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button type="button" variant="outline" onClick={() => void packages.refetch()}>
								<RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
								Try again
							</Button>
						</EmptyContent>
					</Empty>
				) : installed.length === 0 ? (
					<Empty className="border" data-qa-id="environments-conda-detail-empty">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<PackageIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>No packages installed</EmptyTitle>
							<EmptyDescription>Add packages to start using this environment.</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : visible.length === 0 ? (
					<Empty className="border" data-qa-id="environments-conda-detail-empty">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<SearchXIcon aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>No packages match</EmptyTitle>
							<EmptyDescription>
								{search.trim()
									? `Nothing matches “${search.trim()}”.`
									: "No installed packages have updates available."}
							</EmptyDescription>
						</EmptyHeader>
						{hasFilters ? (
							<EmptyContent>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={() => {
										setSearch("");
										setShowUpgradableOnly(false);
									}}
								>
									Clear filters
								</Button>
							</EmptyContent>
						) : null}
					</Empty>
				) : (
					<PackagesTable
						env={env}
						packages={visible}
						selectedNames={selectedNames}
						allSelected={allSelected}
						someSelected={someSelected}
						onToggleSelectAll={toggleSelectAll}
						onToggleSelect={toggleSelect}
						upgradableMap={upgradableMap}
						onUpdatePackage={setRowUpdatePackage}
						updateDisabled={updatingCount > 0}
					/>
				)}
			</div>

			{dialog === "bulk-remove" && (
				<BulkRemoveConfirmation
					env={env}
					packages={selectedPackages}
					open
					onOpenChange={(open) => {
						if (!open) closeDialog();
					}}
					onSuccess={clearSelection}
				/>
			)}
			{dialog === "bulk-update" && (
				<UpdateConfirmationDialog
					env={env}
					upgradablePackages={selectedForUpdate}
					open
					onClose={closeDialog}
					onSuccess={clearSelection}
					onUpdatingChange={bumpUpdating}
				/>
			)}
			{dialog === "update-all" && (
				<UpdateConfirmationDialog
					env={env}
					upgradablePackages={allUpgradable}
					open
					onClose={closeDialog}
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
			{dialog === "clone" && <CloneEnvironmentDialog env={env} open onClose={closeDialog} />}
			{dialog === "delete" && <DeleteEnvironmentDialog env={env} open onClose={closeDialog} />}
			<AddPackageDialog env={env} open={dialog === "add"} onClose={closeDialog} />
		</div>
	);
}

/**
 * Latest versions for installed conda packages, to detect upgrades. Pip
 * packages are excluded (no conda repodata); names are capped at 500.
 */
function usePackageUpgrades(
	conda: ReturnType<typeof useConda>,
	installed: readonly CondaPackage[],
): { upgrades: Upgrades; allUpgradable: UpgradablePackage[]; checkingUpdates: boolean } {
	const condaPackageNames = installed.filter((p) => p.channel !== "pypi").map((p) => p.name);
	const hasCondaPackages = condaPackageNames.length > 0;
	// Query uses the installed package names when available, or a dummy
	// single-name that will return no results when there are no packages yet.
	// The query always runs; repodataArgs decides what it asks for.
	const repodataArgs = hasCondaPackages
		? { names: condaPackageNames.slice(0, 500), limit: 500 }
		: { names: ["__placeholder__"], limit: 1 };
	const repodata = useCondaQuery(conda, "findRepodata", repodataArgs);
	const upgrades = deriveUpgrades(repodata.data as CondaRepodataFindResult | undefined, installed);
	return {
		upgrades,
		allUpgradable: toUpgradables(upgradableOf(installed, upgrades.upgradableMap), upgrades),
		checkingUpdates: repodata.isPending && hasCondaPackages,
	};
}

function usePackageSelection(visible: readonly CondaPackage[]) {
	const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
	const selectedPackages = selectedOf(visible, selectedNames);
	const allSelected = visible.length > 0 && visible.every((pkg) => selectedNames.has(pkg.name));
	const someSelected = !allSelected && visible.some((pkg) => selectedNames.has(pkg.name));

	const toggleSelectAll = () => {
		setSelectedNames(allSelected ? new Set() : new Set(visible.map((pkg) => pkg.name)));
	};

	const toggleSelect = (name: string) => {
		setSelectedNames((prev) => {
			const next = new Set(prev);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});
	};

	const clearSelection = () => setSelectedNames(new Set());

	return {
		selectedNames,
		selectedPackages,
		allSelected,
		someSelected,
		toggleSelect,
		toggleSelectAll,
		clearSelection,
	};
}

function DetailHeading({
	displayName,
	prefix,
	onBack,
	actions,
	children,
}: {
	displayName: string;
	prefix: string;
	onBack: () => void;
	actions: ReactNode;
	children?: ReactNode;
}) {
	return (
		<SettingsPageHeader
			title={displayName}
			description={prefix}
			titleQaId="environments-conda-detail-name"
			descriptionQaId="environments-conda-detail-prefix"
			actions={actions}
			leading={
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="-mx-1.5 -my-0.5"
								aria-label="Back to environments"
								onClick={onBack}
								data-qa-id="environments-conda-detail-back"
							/>
						}
					>
						<ArrowLeftIcon />
					</TooltipTrigger>
					<TooltipContent>Back to environments</TooltipContent>
				</Tooltip>
			}
		>
			{children}
		</SettingsPageHeader>
	);
}

/**
 * Detail view shape shown while the environment list that resolves `prefix`
 * is still loading (a deep link or back-navigation to `?env=`), so the list
 * never flashes in between. The heading is derived from the prefix, which is
 * how conda names environments under an `envs/` directory; the back button
 * already works, while header actions and the package table wait for the
 * real view.
 */
export function EnvironmentDetailLoading({
	prefix,
	onBack,
}: {
	prefix: string;
	onBack: () => void;
}) {
	return (
		<div
			className="flex min-h-0 flex-1 flex-col gap-6"
			data-qa-id="environments-conda-detail-pending"
		>
			<DetailHeading
				displayName={environmentDisplayName({ name: "", prefix })}
				prefix={prefix}
				onBack={onBack}
				actions={
					<Button type="button" size="sm" disabled>
						<PlusIcon data-icon="inline-start" aria-hidden="true" />
						Add packages
					</Button>
				}
			/>
			<div className="flex min-h-0 flex-1 flex-col gap-4">
				<ToolbarSkeleton />
				<PackagesLoading />
			</div>
		</div>
	);
}

interface PackagesTableProps {
	env: CondaEnv;
	packages: CondaPackage[];
	selectedNames: Set<string>;
	allSelected: boolean;
	someSelected: boolean;
	onToggleSelectAll: () => void;
	onToggleSelect: (name: string) => void;
	upgradableMap: Map<string, string>;
	onUpdatePackage: (pkg: CondaPackage) => void;
	/** Disable all per-row Update actions (e.g. while another update is in flight). */
	updateDisabled: boolean;
}

/**
 * The rendered row window as plain values, so the compiled table never holds
 * the virtualizer instance (whose identity stays fixed while its output changes).
 */
function usePackageRowWindow(
	packages: CondaPackage[],
	scrollRef: RefObject<HTMLDivElement | null>,
) {
	// TanStack Virtual returns a mutable instance the compiler cannot memoize safely.
	"use no memo";
	// This hook opts out of the compiler and returns plain values, not the instance.
	// react-doctor-disable-next-line react-hooks-js/incompatible-library
	const virtualizer = useVirtualizer({
		count: packages.length,
		getScrollElement: () => scrollRef.current,
		estimateSize: () => ROW_ESTIMATE_PX,
		getItemKey: (index) => packages[index]?.name ?? index,
		overscan: ROW_OVERSCAN,
	});
	const rows = virtualizer.getVirtualItems();
	return {
		rows,
		paddingTop: rows[0]?.start ?? 0,
		paddingBottom: virtualizer.getTotalSize() - (rows.at(-1)?.end ?? 0),
		measureElement: virtualizer.measureElement,
	};
}

/**
 * Installed packages as the shared `Table`, scrolling inside a bordered panel.
 * Environments routinely hold several hundred packages, so rows are
 * virtualised: spacer rows above and below the rendered window keep the
 * scroll height (and native table layout) intact.
 */
function PackagesTable({
	env,
	packages,
	selectedNames,
	allSelected,
	someSelected,
	onToggleSelectAll,
	onToggleSelect,
	upgradableMap,
	onUpdatePackage,
	updateDisabled,
}: PackagesTableProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const { rows, paddingTop, paddingBottom, measureElement } = usePackageRowWindow(
		packages,
		scrollRef,
	);

	return (
		<div className="border-border flex min-h-0 flex-col overflow-hidden rounded-lg border">
			<div
				ref={scrollRef}
				className="scroll-fade-y min-h-0 overflow-y-auto"
				data-qa-id="environments-conda-detail-table"
			>
				<Table className="table-fixed">
					<TableHeader>
						<TableRow>
							<TableHead scope="col" className="w-9">
								<Checkbox
									checked={allSelected}
									indeterminate={someSelected}
									onCheckedChange={onToggleSelectAll}
									aria-label="Select all packages"
									data-qa-id="environments-conda-detail-select-all"
								/>
							</TableHead>
							<TableHead scope="col" className="w-[32%]">
								Package
							</TableHead>
							<TableHead scope="col" className="w-[20%]">
								Version
							</TableHead>
							<TableHead scope="col" className="w-[14%]">
								Source
							</TableHead>
							<TableHead scope="col">Channel</TableHead>
							<TableHead scope="col" className="w-10">
								<span className="sr-only">Actions</span>
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{paddingTop > 0 ? (
							<tr aria-hidden="true">
								<td colSpan={6} style={{ height: paddingTop, padding: 0 }} />
							</tr>
						) : null}
						{rows.map((row) => {
							const pkg = packages[row.index];
							if (!pkg) return null;
							const isSelected = selectedNames.has(pkg.name);
							const latestVersion = upgradableMap.get(pkg.name);
							return (
								<TableRow
									key={row.key}
									ref={measureElement}
									data-index={row.index}
									data-state={isSelected ? "selected" : undefined}
									data-qa-id="environments-conda-detail-row"
								>
									<TableCell>
										<Checkbox
											checked={isSelected}
											onCheckedChange={() => onToggleSelect(pkg.name)}
											aria-label={`Select ${pkg.name}`}
										/>
									</TableCell>
									<TableCell className="truncate font-medium">{pkg.name}</TableCell>
									<TableCell>
										<div className="flex min-w-0 items-center gap-1.5">
											<span className="text-muted-foreground truncate">{pkg.version}</span>
											{latestVersion && (
												<Tooltip>
													<TooltipTrigger
														render={
															<span
																className="text-success inline-flex shrink-0 cursor-default items-center"
																aria-label={`Update available: ${pkg.version} → ${latestVersion}`}
																data-qa-id="environments-conda-detail-upgrade-badge"
															/>
														}
													>
														<UpdateIcon className="size-3.5" aria-hidden="true" />
													</TooltipTrigger>
													<TooltipContent>
														Update available: {pkg.version} → {latestVersion}
													</TooltipContent>
												</Tooltip>
											)}
										</div>
									</TableCell>
									<TableCell>
										<SourceBadge source={packageSource(pkg)} channel={pkg.channel} />
									</TableCell>
									<TableCell
										className="text-muted-foreground truncate"
										data-qa-id="environments-conda-detail-channel"
									>
										{pkg.channel}
									</TableCell>
									<TableCell>
										<PackageRowActions
											env={env}
											pkg={pkg}
											hasUpdate={!updateDisabled && upgradableMap.has(pkg.name)}
											onUpdate={onUpdatePackage}
										/>
									</TableCell>
								</TableRow>
							);
						})}
						{paddingBottom > 0 ? (
							<tr aria-hidden="true">
								<td colSpan={6} style={{ height: paddingBottom, padding: 0 }} />
							</tr>
						) : null}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

function SourceBadge({ source, channel }: { source: "pip" | "conda"; channel: string }) {
	const isPip = source === "pip";
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Badge
						variant={isPip ? "outline" : "secondary"}
						data-qa-id="environments-conda-detail-source"
					/>
				}
			>
				{source}
			</TooltipTrigger>
			<TooltipContent side="bottom" align="start">
				{isPip ? "Installed with pip (PyPI)" : `Channel: ${channel}`}
			</TooltipContent>
		</Tooltip>
	);
}

const LOADING_ROWS = ["first", "second", "third", "fourth", "fifth"];

/** Matches `Checkbox`: 16px with its 4px radius. */
function CheckboxSkeleton() {
	return <Skeleton className="size-4 rounded-[4px]" />;
}

function PackagesLoading() {
	return (
		<div
			role="status"
			aria-busy="true"
			aria-label="Loading packages"
			className="border-border overflow-hidden rounded-lg border"
			data-qa-id="environments-conda-detail-loading"
		>
			<span className="sr-only">Loading packages</span>
			<Table className="table-fixed" aria-hidden="true">
				<TableHeader>
					<TableRow>
						<TableHead className="w-9">
							<CheckboxSkeleton />
						</TableHead>
						<TableHead className="w-[32%]">Package</TableHead>
						<TableHead className="w-[20%]">Version</TableHead>
						<TableHead className="w-[14%]">Source</TableHead>
						<TableHead>Channel</TableHead>
						<TableHead className="w-10" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{LOADING_ROWS.map((row) => (
						<TableRow key={row}>
							<TableCell>
								<CheckboxSkeleton />
							</TableCell>
							<TableCell>
								<SkeletonText className="w-28" />
							</TableCell>
							<TableCell>
								<SkeletonText className="w-16" />
							</TableCell>
							<TableCell>
								<Skeleton className="h-5 w-12 rounded-4xl" />
							</TableCell>
							<TableCell>
								<SkeletonText className="w-20" />
							</TableCell>
							<TableCell>
								<Skeleton className="size-7" />
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}
