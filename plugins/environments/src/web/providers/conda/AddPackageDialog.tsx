import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	ChevronLeftIcon,
	ChevronRightIcon,
	CircleHelpIcon,
	NetworkIcon,
	PackageIcon,
	SearchIcon,
	XIcon,
} from "lucide-react";

import { useSdk, useSdkMutation, useSdkQuery } from "@kilo-desktop/sdk-react";
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
import { Input } from "@kilo-desktop/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type {
	CondaEnv,
	CondaPackageChange,
	CondaPackagesPreviewResult,
	CondaRepodataFindResult,
	CondaRepodataPackage,
	CondaService,
} from "../../../contracts/providers/conda.js";
import { parseEnvironmentsErrorMessage } from "../../../contracts/common.js";
import { ChannelsDialog } from "./ChannelsDialog.js";
import {
	CHANGE_ICONS,
	CHANGE_VARIANT,
	PreviewContent,
	SolverErrorCard,
	type ChangeFilter,
	type ChangeSection,
} from "./DependencyPreview.js";
import { environmentDisplayName } from "./environment-display.js";
import { friendlyEnvironmentsError } from "./environments-error-message.js";
import {
	showEnvironmentsErrorToast,
	showPackagesInstalledToast,
	trackBackgroundInstallToast,
} from "./environments-toasts.js";

interface AddPackageDialogProps {
	env: CondaEnv;
	open: boolean;
	onClose: () => void;
}

/** A chosen package with an optional pinned version (null = latest). */
interface SelectedPackage {
	name: string;
	version: string | null;
}

const PAGE_SIZE = 20;
const SEARCH_LIMIT = 200;
const LATEST = "__latest__";

function selectedPackageToSpec(pkg: SelectedPackage): string {
	return pkg.version ? `${pkg.name}=${pkg.version}` : pkg.name;
}

function versionValueToPinned(value: string): string | null {
	return value && value !== LATEST ? value : null;
}

/** Human-readable artifact size. Returns empty string for zero/unknown. */
function formatSize(bytes: number | undefined): string {
	if (!bytes || bytes <= 0) return "";
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Size for the row's currently-chosen version (or latest when unpinned). */
function sizeForRow(pkg: CondaRepodataPackage, rowVersion: string): number | undefined {
	if (rowVersion !== LATEST) {
		return pkg.versions.find((v) => v.version === rowVersion)?.size;
	}
	return pkg.versions[0]?.size;
}

/**
 * Modal dialog for searching and adding packages to an existing
 * environment. Uses `conda.repodata.find` for debounced search (matching
 * the CreateEnvironmentDialog pattern) with a `PackageGrid` + sidebar.
 */
export function AddPackageDialog({ env, open, onClose }: AddPackageDialogProps) {
	const sdk = useSdk<CondaService>("environments");
	const install = useSdkMutation(sdk, "conda.packages.install", {
		invalidates: ["conda.packages.list", "conda.repodata.find"],
	});

	const targetName = env.name || "base";
	const displayName = environmentDisplayName(env);

	const [selected, setSelected] = useState<SelectedPackage[]>([]);
	const [rowVersions, setRowVersions] = useState<Record<string, string>>({});
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<CondaRepodataPackage[]>([]);
	const [resultsTruncated, setResultsTruncated] = useState(false);
	const [loadingPackages, setLoadingPackages] = useState(true);
	const [page, setPage] = useState(0);
	const [showChannels, setShowChannels] = useState(false);
	const [selectedChannels, setSelectedChannels] = useState<string[]>([]);

	const channelsArg = useMemo(
		() => (selectedChannels.length > 0 ? selectedChannels : undefined),
		[selectedChannels],
	);

	// ─── Install preview ─────────────────────────────────────────────
	const [preview, setPreview] = useState<CondaPackagesPreviewResult | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [previewError, setPreviewError] = useState<{ message: string; detail?: string } | null>(
		null,
	);
	const [depFilter, setDepFilter] = useState<ChangeFilter>("all");
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	const previewGenRef = useRef(0);
	const lastSpecsKeyRef = useRef("");
	const previewRef = useRef<CondaPackagesPreviewResult | null>(null);
	const previewErrorRef = useRef<{ message: string; detail?: string } | null>(null);

	const runPreview = useCallback(() => {
		if (selected.length === 0) return;
		const specs = selected.map(selectedPackageToSpec);
		const key = specs.join(",");
		if (key === lastSpecsKeyRef.current && previewRef.current && !previewErrorRef.current) return;
		lastSpecsKeyRef.current = key;
		const gen = ++previewGenRef.current;
		setPreviewLoading(true);
		setPreviewError(null);
		previewErrorRef.current = null;
		sdk
			.invoke("conda.packages.previewInstall", {
				name: targetName,
				prefix: env.prefix,
				packages: specs,
				channels: channelsArg,
			})
			.then((result) => {
				if (gen !== previewGenRef.current) return;
				const typed = result as CondaPackagesPreviewResult;
				previewRef.current = typed;
				setPreview(typed);
			})
			.catch((reason) => {
				if (gen !== previewGenRef.current) return;
				const raw =
					reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
				const parsed = raw ? parseEnvironmentsErrorMessage(raw) : null;
				const message = friendlyEnvironmentsError(reason, "Could not preview the install.");
				const detail = parsed?.detail;
				const err = detail ? { message, detail } : { message };
				previewErrorRef.current = err;
				setPreviewError(err);
				previewRef.current = null;
				setPreview(null);
			})
			.finally(() => {
				if (gen === previewGenRef.current) setPreviewLoading(false);
			});
	}, [selected, targetName, env.prefix, channelsArg, sdk]);

	// Auto-preview when the selection changes — debounced so rapid clicks
	// don't fire a solver request per toggle.
	useEffect(() => {
		if (!open || selected.length === 0) {
			setPreview(null);
			setPreviewError(null);
			lastSpecsKeyRef.current = "";
			return;
		}
		const timer = setTimeout(runPreview, 1500);
		return () => clearTimeout(timer);
	}, [open, selected, runPreview]);

	// Derived preview sections, filtering out the explicitly selected packages
	// so only transitive dependency changes are shown.
	const selectedPkgNames = useMemo(() => new Set(selected.map((s) => s.name)), [selected]);
	const { filteredSections, totalChanges, categoryCounts } = useMemo(() => {
		const empty = {
			filteredSections: [] as ChangeSection[],
			totalChanges: 0,
			categoryCounts: new Map<string, number>(),
		};
		if (!preview || preview.nothingToDo) return empty;
		const categories = ["upgraded", "downgraded", "added", "removed", "rebuilt"] as const;
		const sections: ChangeSection[] = [];
		const counts = new Map<string, number>();
		let total = 0;
		for (const cat of categories) {
			const changes = preview[cat].filter((c: CondaPackageChange) => !selectedPkgNames.has(c.name));
			counts.set(cat, changes.length);
			total += changes.length;
			if (depFilter !== "all" && depFilter !== cat) continue;
			if (changes.length > 0) {
				sections.push({
					key: cat,
					title: cat.charAt(0).toUpperCase() + cat.slice(1),
					icon: CHANGE_ICONS[cat]!,
					variant: CHANGE_VARIANT[cat]!,
					changes,
					totalCount: changes.length,
				});
			}
		}
		return { filteredSections: sections, totalChanges: total, categoryCounts: counts };
	}, [preview, selectedPkgNames, depFilter]);

	// The in-flight install job, so "Run in background" can adopt it.
	// `backgrounded` mutes the foreground handlers.
	const pendingInstallRef = useRef<{
		promise: Promise<unknown>;
		count: number;
		backgrounded: boolean;
	} | null>(null);

	const prefixQuery = useSdkQuery(sdk, "conda.envs.prefixOptions");
	const availableChannels = prefixQuery.data?.channels ?? [];

	// Installed packages for this env — rows matching these names are shown
	// greyed out with their installed version instead of a version picker.
	const installedQuery = useSdkQuery(sdk, "conda.packages.list", {
		name: env.name || undefined,
		prefix: env.prefix,
	});
	const installedByName = useMemo(
		() => new Map((installedQuery.data?.packages ?? []).map((p) => [p.name, p.version])),
		[installedQuery.data?.packages],
	);

	// Auto-select all channels when data first loads.
	useEffect(() => {
		if (availableChannels.length > 0 && selectedChannels.length === 0) {
			setSelectedChannels(availableChannels);
		}
	}, [availableChannels]); // eslint-disable-line react-hooks/exhaustive-deps

	// Debounced package search via repodata.find. Waits for prefixOptions
	// to load first so the initial search includes the correct channels —
	// without this gate the first search fires with no channel filter, then
	// a second fires once channels arrive, causing a visible result swap.
	useEffect(() => {
		if (!open || prefixQuery.isPending) return;
		let stale = false;
		const trimmed = query.trim();
		setLoadingPackages(true);
		const timer = setTimeout(() => {
			const args = {
				...(trimmed ? { query: trimmed } : {}),
				limit: SEARCH_LIMIT,
				...(channelsArg ? { channels: channelsArg } : {}),
			};
			sdk
				.invoke("conda.repodata.find", args)
				.then((result) => {
					if (stale) return;
					const { packages, truncated } = result as CondaRepodataFindResult;
					const seen = new Map<string, CondaRepodataPackage>();
					for (const p of packages) {
						if (!seen.has(p.name)) seen.set(p.name, p);
					}
					setResults(Array.from(seen.values()));
					setResultsTruncated(truncated);
					setPage(0);
				})
				.catch(() => {
					if (stale) return;
					setResults([]);
					setResultsTruncated(false);
				})
				.finally(() => {
					if (!stale) setLoadingPackages(false);
				});
		}, 200);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	}, [open, query, channelsArg, sdk, prefixQuery.isPending]);

	const selectedByName = useMemo(() => new Map(selected.map((s) => [s.name, s])), [selected]);
	const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));

	function resetForm() {
		setSelected([]);
		setRowVersions({});
		setQuery("");
		setResults([]);
		setResultsTruncated(false);
		setLoadingPackages(true);
		setPage(0);
		setShowChannels(false);
		setSelectedChannels(availableChannels);
		setPreview(null);
		setPreviewLoading(false);
		setPreviewError(null);
		setDepFilter("all");
		setCollapsed({});
		lastSpecsKeyRef.current = "";
		previewGenRef.current = 0;
		previewRef.current = null;
		previewErrorRef.current = null;
		pendingInstallRef.current = null;
		install.reset();
	}

	function togglePackage(pkg: CondaRepodataPackage, checked: boolean) {
		if (install.isPending || installedByName.has(pkg.name)) return;
		if (checked) {
			if (selectedByName.has(pkg.name)) return;
			const chosen = versionValueToPinned(rowVersions[pkg.name] ?? LATEST);
			setSelected((prev) => [...prev, { name: pkg.name, version: chosen }]);
		} else {
			removePackage(pkg.name);
		}
	}

	function removePackage(pkgName: string) {
		setSelected((prev) => prev.filter((p) => p.name !== pkgName));
	}

	function changeRowVersion(pkg: CondaRepodataPackage, value: string) {
		if (install.isPending) return;
		setRowVersions((prev) => ({ ...prev, [pkg.name]: value }));
		if (selectedByName.has(pkg.name)) {
			const pinned = versionValueToPinned(value);
			setSelected((prev) => prev.map((p) => (p.name === pkg.name ? { ...p, version: pinned } : p)));
		}
	}

	function handleInstall() {
		if (selected.length === 0) return;
		const specs = selected.map(selectedPackageToSpec);
		const count = specs.length;
		const promise = install.mutateAsync({
			name: targetName,
			prefix: env.prefix,
			packages: specs,
			channels: channelsArg,
		});
		const pending = { promise, count, backgrounded: false };
		pendingInstallRef.current = pending;
		promise.then(
			() => {
				if (pending.backgrounded) return;
				showPackagesInstalledToast(displayName, count);
				resetForm();
				onClose();
			},
			(reason) => {
				if (pending.backgrounded) return;
				showEnvironmentsErrorToast(
					"Install failed",
					reason,
					"Could not install the selected packages.",
				);
			},
		);
	}

	function handleRunInBackground() {
		const pending = pendingInstallRef.current;
		if (!pending) return;
		pending.backgrounded = true;
		trackBackgroundInstallToast(
			pending.promise,
			displayName,
			pending.count,
			"Could not install the selected packages.",
		);
		resetForm();
		onClose();
	}

	function handleOpenChange(next: boolean) {
		if (!next) {
			// If a job is running, push it to background instead of blocking close.
			if (install.isPending) {
				handleRunInBackground();
				return;
			}
			resetForm();
			onClose();
		}
	}

	const channelLabel =
		selectedChannels.length === availableChannels.length
			? "All channels"
			: `${selectedChannels.length} channel${selectedChannels.length === 1 ? "" : "s"}`;

	return (
		<>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent
					data-qa-id="environments-conda-add-pkg-dialog"
					className="h-[85vh] max-h-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-7xl"
				>
					<DialogHeader className="shrink-0 border-b px-6 py-4">
						<DialogTitle>
							Add Packages to <span className="text-primary">{displayName}</span>
						</DialogTitle>
					</DialogHeader>

					<div className="flex min-h-0 flex-1 flex-col">
						<div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_22rem]">
							{/* Main column: search + grid */}
							<div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-6 py-5">
								<div className="flex items-center justify-between">
									<h4 className="text-base font-semibold">Select packages:</h4>
									<Button
										type="button"
										variant="outline"
										onClick={() => setShowChannels(true)}
										data-qa-id="environments-conda-add-pkg-channels-btn"
									>
										<NetworkIcon data-icon="inline-start" />
										Channels
										<Badge variant="secondary" className="ml-1">
											{channelLabel}
										</Badge>
									</Button>
								</div>
								<div className="relative">
									<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
									<Input
										type="text"
										placeholder="Search packages…"
										value={query}
										onChange={(e) => setQuery(e.target.value)}
										className="pl-9"
										data-qa-id="environments-conda-add-pkg-search"
									/>
								</div>
								<PackageGrid
									loading={loadingPackages}
									packages={results}
									truncated={resultsTruncated}
									query={query}
									page={page}
									pageCount={pageCount}
									selectedByName={selectedByName}
									installedByName={installedByName}
									rowVersions={rowVersions}
									disabled={install.isPending}
									onToggle={togglePackage}
									onVersionChange={changeRowVersion}
									onPageChange={setPage}
								/>
							</div>

							{/* Sidebar: selected packages + resolution (right column) */}
							<div className="flex min-h-0 flex-col border-l">
								<div className="flex min-h-0 basis-[60%] flex-col">
									<SelectedPackagesSidebar selected={selected} onRemove={removePackage} />
								</div>

								{/* Environment resolution — bottom-right quadrant */}
								<div
									className="flex min-h-0 basis-[40%] flex-col border-t px-4 py-3"
									data-qa-id="environments-conda-add-pkg-preview"
								>
									<div className="mb-2 flex items-center justify-between">
										<h4 className="flex items-center gap-1 text-sm font-semibold">
											Resolution
											<Tooltip>
												<TooltipTrigger
													render={
														<CircleHelpIcon className="text-muted-foreground size-3.5 cursor-help" />
													}
												/>
												<TooltipContent side="bottom" className="max-w-xs text-xs">
													Shows the additional dependency changes the solver will make when
													installing the selected packages — including transitive dependencies that
													will be upgraded, downgraded, added, or removed.
												</TooltipContent>
											</Tooltip>
											{!previewLoading && !previewError && totalChanges > 0 && (
												<Badge variant="secondary" className="ml-2 text-[10px]">
													{totalChanges}
												</Badge>
											)}
										</h4>
										{previewLoading && (
											<div className="flex items-center gap-1.5 text-xs">
												<Spinner size="sm" />
												<span className="text-muted-foreground">Resolving…</span>
											</div>
										)}
									</div>

									{previewError && (
										<SolverErrorCard
											message={previewError.message}
											{...(previewError.detail ? { detail: previewError.detail } : {})}
											qaId="environments-conda-add-pkg-preview-error"
										/>
									)}

									{!previewLoading && !previewError && preview && preview.nothingToDo && (
										<p className="text-muted-foreground text-center text-xs">
											No additional dependency changes needed.
										</p>
									)}

									{!previewLoading && !previewError && preview && !preview.nothingToDo && (
										<>
											{totalChanges > 0 && filteredSections.length > 1 && (
												<div className="mb-2 flex flex-wrap gap-1">
													{(
														[
															["all", "All"],
															["upgraded", "Upgraded"],
															["downgraded", "Downgraded"],
															["added", "Added"],
															["removed", "Removed"],
															["rebuilt", "Rebuilt"],
														] as const
													).map(([value, label]) => {
														const count =
															value === "all" ? totalChanges : (categoryCounts.get(value) ?? 0);
														if (value !== "all" && count === 0) return null;
														return (
															<Button
																key={value}
																type="button"
																variant={depFilter === value ? "default" : "outline"}
																size="sm"
																className="h-7 text-[10px]"
																onClick={() => setDepFilter(value)}
															>
																{label}
																<Badge variant="secondary" className="ml-1 text-[9px]">
																	{count}
																</Badge>
															</Button>
														);
													})}
												</div>
											)}
											<div className="min-h-0 flex-1 overflow-auto">
												{totalChanges === 0 ? (
													<p className="text-muted-foreground text-center text-xs">
														No additional dependency changes needed.
													</p>
												) : (
													<PreviewContent
														sections={filteredSections}
														collapsed={collapsed}
														onToggleCollapse={(key) =>
															setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
														}
													/>
												)}
											</div>
										</>
									)}

									{!previewLoading && !previewError && !preview && selected.length > 0 && (
										<div className="text-muted-foreground flex items-center justify-center gap-2 py-2 text-xs">
											<Spinner size="sm" />
											Preparing preview…
										</div>
									)}

									{selected.length === 0 && (
										<p className="text-muted-foreground flex flex-1 items-center justify-center text-center text-xs">
											Select packages to preview dependency changes.
										</p>
									)}
								</div>
							</div>
						</div>

						{/* In-flight progress bar */}
						{install.isPending && (
							<div className="bg-muted/50 mx-6 mb-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
								<div className="flex items-center gap-2">
									<Spinner size="sm" />
									<span className="text-muted-foreground">
										Installing packages — this may take a few minutes…
									</span>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={handleRunInBackground}
									data-qa-id="environments-conda-add-pkg-background"
								>
									Run in background
								</Button>
							</div>
						)}

						{/* Footer */}
						<div className="flex shrink-0 items-center justify-between border-t px-6 py-4">
							{install.isError && (
								<p
									className="text-destructive text-sm"
									role="alert"
									data-qa-id="environments-conda-add-pkg-error"
								>
									{friendlyEnvironmentsError(
										install.error,
										"Could not install the selected packages.",
									)}
								</p>
							)}
							<div className="ml-auto flex items-center gap-2">
								<Button variant="outline" onClick={() => handleOpenChange(false)}>
									Cancel
								</Button>
								<Button
									onClick={handleInstall}
									disabled={install.isPending || selected.length === 0 || previewLoading}
									data-qa-id="environments-conda-add-pkg-install-btn"
								>
									{install.isPending
										? "Installing…"
										: `Install ${selected.length} ${selected.length === 1 ? "Package" : "Packages"}`}
								</Button>
							</div>
						</div>
					</div>
				</DialogContent>
			</Dialog>

			<ChannelsDialog
				open={showChannels}
				availableChannels={availableChannels}
				selectedChannels={selectedChannels}
				onCancel={() => setShowChannels(false)}
				onConfirm={(channels) => {
					setSelectedChannels(channels);
					setShowChannels(false);
				}}
			/>
		</>
	);
}

/* --------------------------------------------------------------------- */
/* PackageGrid                                                           */
/* --------------------------------------------------------------------- */

interface PackageGridProps {
	loading: boolean;
	packages: CondaRepodataPackage[];
	truncated: boolean;
	query: string;
	page: number;
	pageCount: number;
	selectedByName: Map<string, SelectedPackage>;
	installedByName: Map<string, string>;
	rowVersions: Record<string, string>;
	/** Lock the grid (no toggling or version changes) while an install is in flight. */
	disabled?: boolean;
	onToggle: (pkg: CondaRepodataPackage, checked: boolean) => void;
	onVersionChange: (pkg: CondaRepodataPackage, value: string) => void;
	onPageChange: (page: number) => void;
}

function PackageGrid({
	loading,
	packages,
	truncated,
	query,
	page,
	pageCount,
	selectedByName,
	installedByName,
	rowVersions,
	disabled,
	onToggle,
	onVersionChange,
	onPageChange,
}: PackageGridProps) {
	const pageItems = packages.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
			<div className="text-muted-foreground bg-muted/50 flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
				<span className="w-6" />
				<span className="flex-1">Package</span>
				<span className="w-20 text-right">Size</span>
				<span className="w-32">Version</span>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto">
				{loading && (
					<div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
						<Spinner size="sm" />
						Loading packages…
					</div>
				)}
				{!loading && packages.length === 0 && (
					<p className="text-muted-foreground py-8 text-center text-sm">
						{query.trim() ? `No results for "${query.trim()}"` : "No packages available."}
					</p>
				)}
				{!loading &&
					pageItems.map((pkg) => {
						const isSelected = selectedByName.has(pkg.name);
						const installedVersion = installedByName.get(pkg.name);
						const isInstalled = installedVersion !== undefined;
						const rowLocked = isInstalled || !!disabled;
						const rowVersion = rowVersions[pkg.name] ?? LATEST;
						return (
							<div
								key={pkg.name}
								role="button"
								tabIndex={rowLocked ? -1 : 0}
								aria-pressed={rowLocked ? undefined : isSelected}
								aria-disabled={rowLocked || undefined}
								onClick={() => {
									if (!rowLocked) onToggle(pkg, !isSelected);
								}}
								onKeyDown={(e) => {
									if (rowLocked) return;
									if (e.key === " " || e.key === "Enter") {
										e.preventDefault();
										onToggle(pkg, !isSelected);
									}
								}}
								className={cn(
									"flex items-center gap-2 border-b px-3 py-2 text-sm transition-colors outline-none last:border-b-0",
									rowLocked
										? "cursor-not-allowed opacity-60"
										: "hover:bg-accent focus-visible:ring-ring/50 cursor-pointer focus-visible:ring-2",
								)}
								data-qa-id="environments-conda-add-pkg-row"
							>
								<Checkbox
									checked={isSelected}
									disabled={isInstalled}
									tabIndex={-1}
									aria-hidden
									className="pointer-events-none w-6"
								/>
								<span className="flex min-w-0 flex-1 items-center gap-2">
									<span className="truncate font-medium">{pkg.name}</span>
									{isInstalled && (
										<Badge
											variant="secondary"
											className="shrink-0"
											data-qa-id="environments-conda-add-pkg-row-installed"
										>
											Installed
										</Badge>
									)}
								</span>
								<span className="text-muted-foreground w-20 shrink-0 text-right text-xs">
									{isInstalled ? "" : formatSize(sizeForRow(pkg, rowVersion))}
								</span>
								{isInstalled ? (
									<span className="text-muted-foreground w-32 truncate text-xs">
										{installedVersion}
									</span>
								) : pkg.versions.length > 0 ? (
									<div
										className="w-32"
										onClick={(e) => e.stopPropagation()}
										onKeyDown={(e) => e.stopPropagation()}
									>
										<Select
											value={rowVersion}
											onValueChange={(v) => onVersionChange(pkg, v ?? LATEST)}
											disabled={rowLocked}
										>
											<SelectTrigger
												size="sm"
												className="w-full"
												aria-label={`Version for ${pkg.name}`}
											>
												<SelectValue>
													{(value) => (value === LATEST ? "latest" : value)}
												</SelectValue>
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
									</div>
								) : (
									<span className="text-muted-foreground w-32 truncate text-xs">
										{pkg.version ?? "latest"}
									</span>
								)}
							</div>
						);
					})}
			</div>
			{!loading && truncated && (
				<p className="text-muted-foreground border-t px-3 py-2 text-xs">
					Showing the first {packages.length} packages — refine your search to find others.
				</p>
			)}
			{!loading && packages.length > PAGE_SIZE && (
				<div className="flex items-center justify-between border-t px-3 py-2 text-xs">
					<span className="text-muted-foreground">
						{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, packages.length)} of{" "}
						{packages.length}
					</span>
					<div className="flex items-center gap-1">
						<Button
							type="button"
							variant="outline"
							size="icon-sm"
							disabled={page === 0}
							onClick={() => onPageChange(Math.max(0, page - 1))}
							aria-label="Previous page"
						>
							<ChevronLeftIcon />
						</Button>
						<span className="text-muted-foreground px-1">
							{page + 1} / {pageCount}
						</span>
						<Button
							type="button"
							variant="outline"
							size="icon-sm"
							disabled={page >= pageCount - 1}
							onClick={() => onPageChange(Math.min(pageCount - 1, page + 1))}
							aria-label="Next page"
						>
							<ChevronRightIcon />
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}

/* --------------------------------------------------------------------- */
/* SelectedPackagesSidebar                                               */
/* --------------------------------------------------------------------- */

function SelectedPackagesSidebar({
	selected,
	onRemove,
}: {
	selected: SelectedPackage[];
	onRemove: (name: string) => void;
}) {
	return (
		<aside className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center justify-between border-b px-4 py-4">
				<h3 className="font-semibold">Selected</h3>
				<Badge variant="secondary" data-qa-id="environments-conda-add-pkg-selected-count">
					{selected.length}
				</Badge>
			</div>
			<div
				className="min-h-0 flex-1 overflow-y-auto"
				data-qa-id="environments-conda-add-pkg-selected-list"
			>
				{selected.length === 0 ? (
					<Empty className="h-full">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<PackageIcon />
							</EmptyMedia>
							<EmptyTitle>No packages yet</EmptyTitle>
							<EmptyDescription>Select packages on the left</EmptyDescription>
						</EmptyHeader>
					</Empty>
				) : (
					selected.map((pkg) => (
						<div
							key={pkg.name}
							className="flex items-center gap-2 border-b px-4 py-2.5 last:border-b-0"
						>
							<span className="flex min-w-0 flex-1 flex-col">
								<span className="truncate text-sm font-medium">{pkg.name}</span>
								<span className="text-muted-foreground truncate text-xs">
									{pkg.version ?? "latest"}
								</span>
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="shrink-0"
								onClick={() => onRemove(pkg.name)}
								aria-label={`Remove ${pkg.name}`}
							>
								<XIcon />
							</Button>
						</div>
					))
				)}
			</div>
		</aside>
	);
}
