import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ComponentProps,
	type ReactNode,
} from "react";

import { SearchIcon, SearchXIcon, XIcon } from "lucide-react";

import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import {
	Empty,
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { Skeleton, SkeletonText } from "@kilo-desktop/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kilo-desktop/ui/components/table";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { CondaRepodataPackage } from "../../../contracts/providers/conda.js";
import type { PackageSearch } from "./use-package-search.js";

/** Sentinel Select value for the "latest" (unpinned) package version. */
export const LATEST = "__latest__";

/** A chosen package with an optional pinned version (null = latest). */
export interface SelectedPackage {
	name: string;
	version: string | null;
}

/** Convert a selection to a conda match spec: `name=version` or bare `name`. */
export function selectedPackageToSpec(pkg: SelectedPackage): string {
	return pkg.version ? `${pkg.name}=${pkg.version}` : pkg.name;
}

function versionValueToPinned(value: string): string | null {
	return value && value !== LATEST ? value : null;
}

/** Format a byte count as a human-readable size (e.g. 1536 → "1.5 KB"). */
export function formatSize(bytes: number | undefined): string {
	if (!bytes || bytes <= 0) return "—";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** Size for the row's chosen version, or the newest one when unpinned. */
function sizeForRow(pkg: CondaRepodataPackage, rowVersion: string): number | undefined {
	if (rowVersion !== LATEST) return pkg.versions.find((v) => v.version === rowVersion)?.size;
	return (pkg.versions.find((v) => v.version === pkg.version) ?? pkg.versions[0])?.size;
}

export interface PackageSelection {
	selected: SelectedPackage[];
	selectedByName: Map<string, SelectedPackage>;
	rowVersions: Record<string, string>;
	toggle: (pkg: CondaRepodataPackage, checked: boolean) => void;
	remove: (name: string) => void;
	changeVersion: (pkg: CondaRepodataPackage, value: string) => void;
	reset: () => void;
}

/**
 * Selected packages plus each result row's chosen version. A row keeps its
 * version choice while unselected, so ticking it later installs what the
 * row shows.
 */
export function usePackageSelection(): PackageSelection {
	const [selected, setSelected] = useState<SelectedPackage[]>([]);
	const [rowVersions, setRowVersions] = useState<Record<string, string>>({});
	const selectedByName = useMemo(() => new Map(selected.map((s) => [s.name, s])), [selected]);

	const remove = useCallback((name: string) => {
		setSelected((prev) => prev.filter((p) => p.name !== name));
	}, []);

	const toggle = useCallback(
		(pkg: CondaRepodataPackage, checked: boolean) => {
			if (!checked) {
				remove(pkg.name);
				return;
			}
			setSelected((prev) =>
				prev.some((p) => p.name === pkg.name)
					? prev
					: [
							...prev,
							{ name: pkg.name, version: versionValueToPinned(rowVersions[pkg.name] ?? LATEST) },
						],
			);
		},
		[remove, rowVersions],
	);

	const changeVersion = useCallback((pkg: CondaRepodataPackage, value: string) => {
		setRowVersions((prev) => ({ ...prev, [pkg.name]: value }));
		const pinned = versionValueToPinned(value);
		setSelected((prev) => prev.map((p) => (p.name === pkg.name ? { ...p, version: pinned } : p)));
	}, []);

	const reset = useCallback(() => {
		setSelected([]);
		setRowVersions({});
	}, []);

	return { selected, selectedByName, rowVersions, toggle, remove, changeVersion, reset };
}

export function PackageSearchInput({
	value,
	onChange,
	qaId,
}: {
	value: string;
	onChange: (value: string) => void;
	qaId: string;
}) {
	return (
		<InputGroup className="min-w-40 flex-1">
			<InputGroupInput
				type="search"
				value={value}
				onChange={(event) => onChange(event.currentTarget.value)}
				placeholder="Search packages"
				aria-label="Search packages"
				data-qa-id={qaId}
			/>
			<InputGroupAddon>
				<SearchIcon aria-hidden="true" />
			</InputGroupAddon>
		</InputGroup>
	);
}

const SKELETON_ROWS = ["first", "second", "third", "fourth", "fifth", "sixth"];
const MORE_SKELETON_ROWS = ["first", "second", "third"];

interface PackageResultsTableProps {
	search: PackageSearch;
	query: string;
	selection: PackageSelection;
	/** Installed name → version; those rows show the version and cannot be selected. */
	installedByName?: Map<string, string>;
	/** Lock every row (no toggling or version changes), e.g. while installing. */
	disabled?: boolean;
	/** `data-qa-id` stem for rows and cells, e.g. `environments-create-package`. */
	qaPrefix: string;
}

/**
 * Package search results as the shared `Table` in a bordered, scrolling
 * panel. Skeleton rows appear only before any results exist; a new query keeps
 * the previous rows (and scroll position) until its results land. Reaching the
 * end of the list requests the next batch, and a muted row asks the user to
 * refine the search once the result cap is reached.
 */
export function PackageResultsTable({
	search,
	query,
	selection,
	installedByName,
	disabled = false,
	qaPrefix,
}: PackageResultsTableProps) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const sentinelRef = useRef<HTMLTableRowElement>(null);
	const { packages, loading, loadingMore, hasMore, atCap, loadMore } = search;

	useEffect(() => {
		const sentinel = sentinelRef.current;
		if (!sentinel || !hasMore || loadingMore) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) loadMore();
			},
			{ root: scrollRef.current, rootMargin: "0px 0px 120px 0px" },
		);
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [hasMore, loadingMore, loadMore, packages.length]);

	if (!loading && packages.length === 0) {
		return (
			<Empty className="border" data-qa-id={`${qaPrefix}-empty`}>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<SearchXIcon aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>
						{query.trim() ? `No results for “${query.trim()}”` : "No packages available"}
					</EmptyTitle>
					<EmptyDescription>
						{query.trim()
							? "Check the spelling or choose other channels."
							: "The selected channels do not provide any packages."}
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		);
	}

	return (
		<div className="border-border flex min-h-0 flex-col overflow-hidden rounded-lg border">
			<div
				ref={scrollRef}
				className="scroll-fade-y min-h-0 overflow-y-auto"
				aria-busy={loading || loadingMore}
				data-qa-id={`${qaPrefix}-results`}
			>
				<Table className="table-fixed">
					<TableHeader>
						<TableRow>
							<TableHead scope="col" className="w-9">
								<span className="sr-only">Selected</span>
							</TableHead>
							<TableHead scope="col">Package</TableHead>
							<TableHead scope="col" className="w-24 text-right">
								Size
							</TableHead>
							<TableHead scope="col" className="w-36">
								Version
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{loading && packages.length === 0 ? (
							<ResultSkeletonRows rows={SKELETON_ROWS} />
						) : (
							packages.map((pkg) => (
								<PackageResultRow
									key={pkg.name}
									pkg={pkg}
									selected={selection.selectedByName.has(pkg.name)}
									rowVersion={selection.rowVersions[pkg.name] ?? LATEST}
									installedVersion={installedByName?.get(pkg.name)}
									disabled={disabled}
									onToggle={(checked) => selection.toggle(pkg, checked)}
									onVersionChange={(value) => selection.changeVersion(pkg, value)}
									qaPrefix={qaPrefix}
								/>
							))
						)}
						{loadingMore ? <ResultSkeletonRows rows={MORE_SKELETON_ROWS} /> : null}
						{hasMore && !loadingMore ? (
							<tr ref={sentinelRef} aria-hidden="true">
								<td colSpan={4} className="h-px p-0" />
							</tr>
						) : null}
						{atCap ? (
							<TableRow data-qa-id={`${qaPrefix}-refine-hint`}>
								<TableCell colSpan={4} className="text-muted-foreground text-center">
									Refine your search to see more results
								</TableCell>
							</TableRow>
						) : null}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

function ResultSkeletonRows({ rows }: { rows: string[] }) {
	return rows.map((row) => (
		<TableRow key={row} aria-hidden="true">
			<TableCell>
				<Skeleton className="size-4 rounded-[4px]" />
			</TableCell>
			<TableCell>
				<SkeletonText className="w-32" />
			</TableCell>
			<TableCell className="text-right">
				<SkeletonText className="w-12" />
			</TableCell>
			<TableCell>
				<Skeleton className="h-7 w-full" />
			</TableCell>
		</TableRow>
	));
}

function PackageResultRow({
	pkg,
	selected,
	rowVersion,
	installedVersion,
	disabled,
	onToggle,
	onVersionChange,
	qaPrefix,
}: {
	pkg: CondaRepodataPackage;
	selected: boolean;
	rowVersion: string;
	installedVersion: string | undefined;
	disabled: boolean;
	onToggle: (checked: boolean) => void;
	onVersionChange: (value: string) => void;
	qaPrefix: string;
}) {
	const installed = installedVersion !== undefined;
	const locked = installed || disabled;

	return (
		<TableRow
			data-state={selected ? "selected" : undefined}
			aria-disabled={locked || undefined}
			className={locked ? undefined : "cursor-pointer"}
			onClick={() => {
				if (!locked) onToggle(!selected);
			}}
			data-qa-id={`${qaPrefix}-row`}
		>
			<TableCell onClick={(event) => event.stopPropagation()}>
				<Checkbox
					checked={selected}
					disabled={locked}
					onCheckedChange={(checked) => onToggle(checked === true)}
					aria-label={`Select ${pkg.name}`}
					data-qa-id={`${qaPrefix}-checkbox-${pkg.name}`}
				/>
			</TableCell>
			<TableCell>
				<div className="flex min-w-0 items-center gap-2">
					<span className="truncate font-medium">{pkg.name}</span>
					{installed ? (
						<Badge variant="secondary" data-qa-id={`${qaPrefix}-row-installed`}>
							Installed
						</Badge>
					) : null}
				</div>
			</TableCell>
			<TableCell
				className="text-muted-foreground text-right tabular-nums"
				data-qa-id={`${qaPrefix}-size-${pkg.name}`}
			>
				{installed ? "" : formatSize(sizeForRow(pkg, rowVersion))}
			</TableCell>
			<TableCell onClick={(event) => event.stopPropagation()}>
				{installed ? (
					<span className="text-muted-foreground block truncate">{installedVersion}</span>
				) : pkg.versions.length > 0 ? (
					<Select
						value={rowVersion}
						onValueChange={(value) => onVersionChange(value ?? LATEST)}
						disabled={locked}
					>
						<SelectTrigger size="sm" className="w-full" aria-label={`Version for ${pkg.name}`}>
							<SelectValue>{(value) => (value === LATEST ? "latest" : value)}</SelectValue>
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={LATEST}>{pkg.version ?? "latest"} (latest)</SelectItem>
							{pkg.versions.map((v) => (
								<SelectItem key={v.version} value={v.version}>
									{v.version}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<span className="text-muted-foreground block truncate">{pkg.version ?? "latest"}</span>
				)}
			</TableCell>
		</TableRow>
	);
}

/**
 * Dialog right panel listing the packages picked so far, with a remove button
 * each. Callers mount it only once something is selected, so it has no empty
 * state. `children` renders below the list (the install preview in Add
 * packages). The header keeps its right edge clear for the dialog close button.
 */
export function SelectedPackagesPane({
	selection,
	qaPrefix,
	children,
}: {
	selection: PackageSelection;
	/** `data-qa-id` stem, e.g. `environments-create`. */
	qaPrefix: string;
	children?: ReactNode;
}) {
	const { selected, remove } = selection;
	return (
		<aside
			className="bg-background/60 border-border flex min-h-0 min-w-0 flex-col border-t md:border-t-0 md:border-l"
			aria-label="Selected packages"
		>
			<div className="scroll-fade-y min-h-0 flex-1 overflow-y-auto pb-2">
				<PanelSectionHeading count={selected.length} countQaId={`${qaPrefix}-selected-count`}>
					Selected packages
				</PanelSectionHeading>
				<div className="px-4">
					<PanelList data-qa-id={`${qaPrefix}-selected-list`}>
						{selected.map((pkg) => (
							<PanelListRow
								key={pkg.name}
								className="pr-1.5"
								data-qa-id={`${qaPrefix}-selected-item`}
							>
								<span className="min-w-0 flex-1 truncate font-medium" title={pkg.name}>
									{pkg.name}
								</span>
								<span className="text-muted-foreground shrink-0 tabular-nums">
									{pkg.version ?? "latest"}
								</span>
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									onClick={() => remove(pkg.name)}
									aria-label={`Remove ${pkg.name}`}
								>
									<XIcon />
								</Button>
							</PanelListRow>
						))}
					</PanelList>
				</div>
				{children}
			</div>
		</aside>
	);
}

/**
 * Section heading inside the dialog right panel: title with a muted count,
 * and an optional trailing action (e.g. a filter button).
 */
export function PanelSectionHeading({
	children,
	count,
	countQaId,
	action,
	id,
}: {
	children: ReactNode;
	count?: number | undefined;
	countQaId?: string;
	action?: ReactNode;
	id?: string;
}) {
	return (
		<div className="flex h-12 items-center justify-between gap-2 px-4 pt-2">
			<h3 className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
				<span id={id}>{children}</span>
				{count !== undefined ? (
					<span className="text-muted-foreground font-normal tabular-nums" data-qa-id={countQaId}>
						{count}
					</span>
				) : null}
			</h3>
			{action}
		</div>
	);
}

/** Bordered, divided list used for the rows in the dialog right panel. */
export function PanelList({ className, ...props }: ComponentProps<"ul">) {
	return (
		<ul
			className={cn("border-border divide-border divide-y rounded-lg border", className)}
			{...props}
		/>
	);
}

export function PanelListRow({ className, ...props }: ComponentProps<"li">) {
	return (
		<li className={cn("flex h-9 min-w-0 items-center gap-2 px-3 text-sm", className)} {...props} />
	);
}
