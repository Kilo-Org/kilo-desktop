import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
	ArrowDownIcon,
	ArrowRightIcon,
	ArrowUpIcon,
	CircleHelpIcon,
	CopyIcon,
	MinusIcon,
	PlusIcon,
	RefreshCwIcon,
	RepeatIcon,
	SearchIcon,
} from "lucide-react";

import { useSdk, useSdkMutation, useSdkQuery } from "@kilo-desktop/sdk-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import { Input } from "@kilo-desktop/ui/components/input";
import { Label } from "@kilo-desktop/ui/components/label";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { toast } from "@kilo-desktop/ui/components/sonner";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@kilo-desktop/ui/components/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";

import type {
	CondaEnv,
	CondaPackage,
	CondaPackageChange,
	CondaPackagesPreviewResult,
	CondaService,
} from "../../../contracts/providers/conda.js";
import { parseEnvironmentsErrorMessage } from "../../../contracts/common.js";
import { environmentDisplayName, validateEnvironmentName } from "./environment-display.js";
import { friendlyEnvironmentsError } from "./environments-error-message.js";
import { showEnvironmentsErrorToast, showPackagesUpdatedToast } from "./environments-toasts.js";
import { PreviewContent, SolverErrorCard, type ChangeSection } from "./DependencyPreview.js";

export interface UpgradablePackage {
	pkg: CondaPackage;
	/** Latest available version, or null when the package is already up to date. */
	latestVersion: string | null;
	/** All available versions newer than the installed one, ordered newest first. Empty when up to date. */
	availableVersions: string[];
}

/**
 * Build the pinned matchspecs sent to conda for both preview and update.
 * Pinning `name=version` (rather than the bare name) prevents the solver
 * from silently no-op'ing when the environment's constraints block the
 * upgrade — see the previous fix for the "python 3.11 → 3.14" no-op bug.
 *
 * Callers must pass items filtered to `latestVersion !== null`; the `!`
 * fallback below relies on that invariant.
 */
function buildUpdateSpecs(
	upgradableItems: readonly UpgradablePackage[],
	selectedVersions: Readonly<Record<string, string>>,
): string[] {
	return upgradableItems.map((u) => {
		const ver = selectedVersions[u.pkg.name] ?? u.latestVersion!;
		return `${u.pkg.name}=${ver}`;
	});
}

interface UpdateConfirmationDialogProps {
	env: CondaEnv;
	upgradablePackages: UpgradablePackage[];
	open: boolean;
	onClose: () => void;
	onSuccess: () => void;
	/**
	 * Called with a positive delta when a background update starts and a
	 * matching negative delta when it settles, so the parent can track
	 * concurrent in-flight jobs as a single counter.
	 */
	onUpdatingChange?: (delta: number) => void;
}

type ChangeFilter = "all" | "upgraded" | "downgraded" | "added" | "removed" | "rebuilt";

export function UpdateConfirmationDialog({
	env,
	upgradablePackages,
	open,
	onClose,
	onSuccess,
	onUpdatingChange,
}: UpdateConfirmationDialogProps) {
	const sdk = useSdk<CondaService>("environments");
	const queryClient = useQueryClient();
	const envList = useSdkQuery(sdk, "conda.envs.list");
	const existingEnvNames = useMemo(
		() => new Set((envList.data ?? []).map((e) => e.name).filter(Boolean)),
		[envList.data],
	);
	const cloneMutation = useSdkMutation(sdk, "conda.envs.clone", {
		invalidates: ["conda.envs.list"],
	});

	const items = upgradablePackages;
	// Set of package names that are checked (included in the update).
	const [checkedPkgs, setCheckedPkgs] = useState<Set<string>>(
		() =>
			new Set(upgradablePackages.filter((u) => u.latestVersion !== null).map((u) => u.pkg.name)),
	);
	// Per-package target version; defaults to latestVersion for each upgradable package.
	const [selectedVersions, setSelectedVersions] = useState<Record<string, string>>(() =>
		Object.fromEntries(
			upgradablePackages
				.filter((u): u is UpgradablePackage & { latestVersion: string } => u.latestVersion !== null)
				.map((u) => [u.pkg.name, u.latestVersion]),
		),
	);
	const [backup, setBackup] = useState(false);
	const [backupName, setBackupName] = useState("");

	// Validate backup name: format check + uniqueness check against existing envs.
	const backupNameError = useMemo(() => {
		if (!backup) return null;
		const trimmed = backupName.trim();
		if (!trimmed) return null; // Don't show error for empty — the submit button handles that
		const formatError = validateEnvironmentName(trimmed);
		if (formatError) return formatError;
		if (existingEnvNames.has(trimmed)) {
			return `An environment named "${trimmed}" already exists. Choose a different name.`;
		}
		return null;
	}, [backup, backupName, existingEnvNames]);

	// Preview state
	const [preview, setPreview] = useState<CondaPackagesPreviewResult | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [previewError, setPreviewError] = useState<{ message: string; detail?: string } | null>(
		null,
	);
	const [previewStale, setPreviewStale] = useState(false);
	const [autoPreview, setAutoPreview] = useState(true);

	// Package list search (left panel)
	const [pkgSearch, setPkgSearch] = useState("");

	// Dependency panel controls
	const [depSearch, setDepSearch] = useState("");
	const [depFilter, setDepFilter] = useState<ChangeFilter>("all");
	const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
	// Track which category buttons were visible in the last completed preview,
	// so loading/stale states don't add or remove buttons mid-resolve.
	const [visibleCategories, setVisibleCategories] = useState<Set<string>>(new Set());

	const targetName = env.name || "base";
	const displayName = environmentDisplayName(env);

	// Stable ref for the current item names — used to dedupe preview calls
	const itemNamesRef = useRef<string>("");
	const previewGenRef = useRef(0);
	const previewRef = useRef<CondaPackagesPreviewResult | null>(null);
	const previewStaleRef = useRef(false);

	// Only checked packages with an available update are sent to the solver.
	const upgradableItems = useMemo(
		() => items.filter((u) => u.latestVersion !== null && checkedPkgs.has(u.pkg.name)),
		[items, checkedPkgs],
	);

	const runPreview = useCallback(() => {
		if (upgradableItems.length === 0) return;
		// Pin target versions — see buildUpdateSpecs.
		const specs = buildUpdateSpecs(upgradableItems, selectedVersions);
		const key = specs.join(",");
		if (key === itemNamesRef.current && previewRef.current && !previewStaleRef.current) return;
		itemNamesRef.current = key;
		const gen = ++previewGenRef.current;
		setPreviewLoading(true);
		setPreviewError(null);
		setPreviewStale(false);
		previewStaleRef.current = false;
		sdk
			.invoke("conda.packages.preview", {
				name: targetName,
				prefix: env.prefix,
				packages: specs,
			})
			.then((result) => {
				if (gen !== previewGenRef.current) return;
				const prev = result as CondaPackagesPreviewResult;
				setPreview(prev);
				previewRef.current = prev;
				const cats = new Set<string>(["all"]);
				if (prev.upgraded.length > 0) cats.add("upgraded");
				if (prev.downgraded.length > 0) cats.add("downgraded");
				if (prev.added.length > 0) cats.add("added");
				if (prev.removed.length > 0) cats.add("removed");
				if (prev.rebuilt.length > 0) cats.add("rebuilt");
				setVisibleCategories(cats);
			})
			.catch((reason) => {
				if (gen !== previewGenRef.current) return;
				const raw =
					reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "";
				const parsed = raw ? parseEnvironmentsErrorMessage(raw) : null;
				const message = friendlyEnvironmentsError(reason, "Could not preview the update.");
				const detail = parsed?.detail;
				setPreviewError(detail ? { message, detail } : { message });
				setPreview(null);
				previewRef.current = null;
			})
			.finally(() => {
				if (gen === previewGenRef.current) setPreviewLoading(false);
			});
	}, [upgradableItems, selectedVersions, targetName, env.prefix, sdk]);

	// Auto-run preview on open
	useEffect(() => {
		if (open) {
			setCheckedPkgs(
				new Set(upgradablePackages.filter((u) => u.latestVersion !== null).map((u) => u.pkg.name)),
			);
			setSelectedVersions(
				Object.fromEntries(
					upgradablePackages
						.filter(
							(u): u is UpgradablePackage & { latestVersion: string } => u.latestVersion !== null,
						)
						.map((u) => [u.pkg.name, u.latestVersion]),
				),
			);
			setBackup(false);
			setBackupName(`${targetName}-backup`);
			setPreview(null);
			setPreviewLoading(false);
			setPreviewError(null);
			setPreviewStale(false);
			setAutoPreview(true);
			setPkgSearch("");
			setDepSearch("");
			setDepFilter("all");
			setCollapsed({});
			itemNamesRef.current = "";
			previewGenRef.current = 0;
			previewRef.current = null;
			previewStaleRef.current = false;
		}
	}, [open]); // eslint-disable-line react-hooks/exhaustive-deps

	// Trigger initial preview after items are set
	useEffect(() => {
		if (open && items.length > 0 && !preview && !previewLoading && !previewError) {
			runPreview();
		}
	}, [open, items.length, preview, previewLoading, previewError, runPreview]);

	function togglePackage(name: string) {
		setCheckedPkgs((prev) => {
			const next = new Set(prev);
			if (next.has(name)) {
				next.delete(name);
			} else {
				next.add(name);
			}
			return next;
		});
		setPreviewStale(true);
		previewStaleRef.current = true;
		setPreviewError(null);
	}

	// Names of packages that can actually be updated (drives the header
	// select-all checkbox; up-to-date rows have no checkbox).
	const updatableNames = useMemo(
		() => items.filter((u) => u.latestVersion !== null).map((u) => u.pkg.name),
		[items],
	);
	const allChecked =
		updatableNames.length > 0 && updatableNames.every((name) => checkedPkgs.has(name));
	const someChecked = !allChecked && updatableNames.some((name) => checkedPkgs.has(name));

	function toggleAllPackages() {
		setCheckedPkgs(allChecked ? new Set() : new Set(updatableNames));
		setPreviewStale(true);
		previewStaleRef.current = true;
		setPreviewError(null);
	}

	function changeVersion(name: string, version: string) {
		setSelectedVersions((prev) => ({ ...prev, [name]: version }));
		setPreviewStale(true);
		previewStaleRef.current = true;
		setPreviewError(null);
	}

	// Auto-preview when items change (if enabled).
	// Uses a 2s debounce so rapid removals don't trigger multiple solves.
	useEffect(() => {
		if (!open || !autoPreview || !previewStale || previewLoading) return;
		const timer = setTimeout(runPreview, 2000);
		return () => clearTimeout(timer);
	}, [open, autoPreview, previewStale, previewLoading, runPreview]);

	function toggleCollapse(section: string) {
		setCollapsed((prev) => ({ ...prev, [section]: !prev[section] }));
	}

	// Packages selected for update on the left — excluded from the dependency panel
	// so the right side only shows transitive (indirect) changes.
	const selectedPkgNames = useMemo(() => new Set(items.map((u) => u.pkg.name)), [items]);

	// Filtered changes for the dependency panel
	const filteredSections = useMemo(() => {
		if (!preview || preview.nothingToDo) return [];
		const needle = depSearch.trim().toLowerCase();
		function filterChanges(changes: CondaPackageChange[]): CondaPackageChange[] {
			let filtered = changes.filter((c) => !selectedPkgNames.has(c.name));
			if (needle) {
				filtered = filtered.filter((c) => c.name.toLowerCase().includes(needle));
			}
			return filtered;
		}
		function transitivCount(changes: CondaPackageChange[]): number {
			return changes.filter((c) => !selectedPkgNames.has(c.name)).length;
		}
		const sections: ChangeSection[] = [];
		if ((depFilter === "all" || depFilter === "upgraded") && transitivCount(preview.upgraded) > 0) {
			sections.push({
				key: "upgraded",
				title: "Upgraded",
				icon: <ArrowUpIcon className="size-3.5 text-green-600" />,
				variant: "upgrade",
				changes: filterChanges(preview.upgraded),
				totalCount: transitivCount(preview.upgraded),
			});
		}
		if (
			(depFilter === "all" || depFilter === "downgraded") &&
			transitivCount(preview.downgraded) > 0
		) {
			sections.push({
				key: "downgraded",
				title: "Downgraded",
				icon: <ArrowDownIcon className="size-3.5 text-amber-600" />,
				variant: "downgrade",
				changes: filterChanges(preview.downgraded),
				totalCount: transitivCount(preview.downgraded),
			});
		}
		if ((depFilter === "all" || depFilter === "added") && transitivCount(preview.added) > 0) {
			sections.push({
				key: "added",
				title: "Added",
				icon: <PlusIcon className="size-3.5 text-blue-600" />,
				variant: "add",
				changes: filterChanges(preview.added),
				totalCount: transitivCount(preview.added),
			});
		}
		if ((depFilter === "all" || depFilter === "removed") && transitivCount(preview.removed) > 0) {
			sections.push({
				key: "removed",
				title: "Removed",
				icon: <MinusIcon className="size-3.5 text-red-600" />,
				variant: "remove",
				changes: filterChanges(preview.removed),
				totalCount: transitivCount(preview.removed),
			});
		}
		if ((depFilter === "all" || depFilter === "rebuilt") && transitivCount(preview.rebuilt) > 0) {
			sections.push({
				key: "rebuilt",
				title: "Rebuilt",
				icon: <RepeatIcon className="size-3.5 text-gray-600" />,
				variant: "upgrade",
				changes: filterChanges(preview.rebuilt),
				totalCount: transitivCount(preview.rebuilt),
			});
		}
		return sections;
	}, [preview, depSearch, depFilter, selectedPkgNames]);

	const totalChanges = useMemo(() => {
		if (!preview) return 0;
		const isTransitive = (c: CondaPackageChange) => !selectedPkgNames.has(c.name);
		return (
			preview.upgraded.filter(isTransitive).length +
			preview.downgraded.filter(isTransitive).length +
			preview.added.filter(isTransitive).length +
			preview.removed.filter(isTransitive).length +
			preview.rebuilt.filter(isTransitive).length
		);
	}, [preview, selectedPkgNames]);

	// ─── Background operations ─────────────────────────────────────────

	// Shared post-update handlers. Both runUpdateInBackground and
	// runBackupThenUpdate must invalidate the same query keys and surface
	// the same toasts — extracting them here keeps the two paths in sync.
	function finishUpdate(count: number, toastId: string | number, reason?: unknown) {
		if (reason) {
			showEnvironmentsErrorToast(
				"Update failed",
				reason,
				"Could not update the selected packages.",
				toastId,
			);
		} else {
			queryClient.invalidateQueries({ queryKey: [sdk.featureId, "conda.packages.list"] });
			queryClient.invalidateQueries({ queryKey: [sdk.featureId, "conda.repodata.find"] });
			showPackagesUpdatedToast(displayName, count, toastId);
		}
		onUpdatingChange?.(-count);
	}

	function runUpdateInBackground(packageSpecs: string[], existingToastId?: string | number) {
		const count = packageSpecs.length;
		onUpdatingChange?.(count);
		const toastId = toast.loading(`Updating ${count} ${count === 1 ? "package" : "packages"}…`, {
			...(existingToastId !== undefined ? { id: existingToastId } : {}),
			description: `Resolving dependencies for ${displayName}.`,
		});
		sdk
			.invoke("conda.packages.update", {
				name: targetName,
				prefix: env.prefix,
				packages: packageSpecs,
			})
			.then(
				() => finishUpdate(count, toastId),
				(reason) => finishUpdate(count, toastId, reason),
			);
	}

	function runBackupThenUpdate(packageSpecs: string[], cloneName: string) {
		const count = packageSpecs.length;
		onUpdatingChange?.(count);
		let backupFailed = false;
		let updateAnywayClicked = false;
		const toastId = toast.loading(`Backing up ${displayName}…`, {
			description: `Cloning to ${cloneName} before updating.`,
		});

		cloneMutation
			.mutateAsync({
				sourceName: targetName,
				sourcePrefix: env.prefix,
				name: cloneName,
			})
			.then(
				() => {
					toast.loading(`Updating ${count} ${count === 1 ? "package" : "packages"}…`, {
						id: toastId,
						description: `Backup complete. Resolving dependencies for ${displayName}.`,
					});
					return sdk.invoke("conda.packages.update", {
						name: targetName,
						prefix: env.prefix,
						packages: packageSpecs,
					});
				},
				(reason) => {
					backupFailed = true;
					const message = friendlyEnvironmentsError(reason, "Could not back up the environment.");
					toast.error("Backup failed", {
						id: toastId,
						description: message,
						duration: Infinity,
						action: {
							label: "Update anyway",
							onClick: () => {
								if (updateAnywayClicked) return;
								updateAnywayClicked = true;
								runUpdateInBackground(packageSpecs, toastId);
							},
						},
					});
					onUpdatingChange?.(-count);
					return Promise.reject(reason);
				},
			)
			.then(
				() => finishUpdate(count, toastId),
				(reason) => {
					if (!backupFailed) {
						finishUpdate(count, toastId, reason);
					}
				},
			);
	}

	function handleSubmit() {
		if (upgradableItems.length === 0) return;
		const specs = buildUpdateSpecs(upgradableItems, selectedVersions);
		onClose();
		onSuccess();
		if (backup && backupName.trim()) {
			runBackupThenUpdate(specs, backupName.trim());
		} else {
			runUpdateInBackground(specs);
		}
	}

	// ─── Render ────────────────────────────────────────────────────────

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent
				data-qa-id="environments-conda-update-confirm-dialog"
				className="h-[85vh] max-h-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-5xl"
			>
				<DialogHeader className="shrink-0 border-b px-6 py-4">
					<DialogTitle>
						Update {upgradableItems.length} {upgradableItems.length === 1 ? "Package" : "Packages"}{" "}
						in <span className="text-primary-ink">{displayName}</span>
					</DialogTitle>
				</DialogHeader>

				<div className="flex min-h-0 flex-1 flex-col">
					<div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_1fr]">
						{/* ── Left: package selection ────────────────────────── */}
						<div className="flex min-h-0 flex-col border-r px-6 py-5">
							<h4 className="mb-2 text-sm font-semibold">
								Packages to update
								<span className="text-muted-foreground ml-1 font-normal">
									— uncheck any you want to skip
								</span>
							</h4>
							<div className="relative mb-3">
								<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
								<Input
									type="text"
									placeholder="Search packages…"
									value={pkgSearch}
									onChange={(e) => setPkgSearch(e.target.value)}
									className="h-7 pl-7 text-xs"
								/>
							</div>
							<div className="min-h-0 flex-1 overflow-auto rounded-lg border">
								{items.length === 0 ? (
									<p className="text-muted-foreground py-6 text-center text-sm">
										No packages to update.
									</p>
								) : (
									<table className="w-full text-sm">
										<thead className="bg-muted/50 sticky top-0 z-10">
											<tr className="border-b text-xs font-medium">
												<th className="w-8 px-2 py-2">
													{updatableNames.length > 0 && (
														<Checkbox
															checked={allChecked}
															indeterminate={someChecked}
															onCheckedChange={toggleAllPackages}
															className="size-4"
															aria-label={
																allChecked ? "Unselect all packages" : "Select all packages"
															}
															data-qa-id="environments-conda-update-confirm-select-all"
														/>
													)}
												</th>
												<th className="px-3 py-2 text-left">Package</th>
												<th className="px-3 py-2 text-left">Current</th>
												<th className="px-1 py-2" />
												<th className="px-3 py-2 text-left">New</th>
											</tr>
										</thead>
										<tbody>
											{items
												.filter((u) => {
													if (!pkgSearch.trim()) return true;
													return u.pkg.name.toLowerCase().includes(pkgSearch.trim().toLowerCase());
												})
												.map(({ pkg, latestVersion, availableVersions }) => {
													const upToDate = !latestVersion;
													const isChecked = checkedPkgs.has(pkg.name);
													const dimmed = upToDate || !isChecked;
													return (
														<tr
															key={pkg.name}
															className={`border-b transition-opacity duration-150 last:border-b-0 ${dimmed ? "opacity-40" : ""}`}
														>
															<td className="px-2 py-2">
																{!upToDate && (
																	<Checkbox
																		checked={isChecked}
																		onCheckedChange={() => togglePackage(pkg.name)}
																		className="size-4"
																		aria-label={`Include ${pkg.name} in update`}
																	/>
																)}
															</td>
															<td className="px-3 py-2 font-medium">{pkg.name}</td>
															<td className="text-muted-foreground px-3 py-2">{pkg.version}</td>
															<td className="px-1 py-2">
																{upToDate ? null : (
																	<ArrowRightIcon className="text-muted-foreground size-3" />
																)}
															</td>
															<td className="px-3 py-2">
																{upToDate ? (
																	<span className="text-muted-foreground text-xs italic">
																		up to date
																	</span>
																) : availableVersions.length <= 1 ? (
																	<Tooltip>
																		<TooltipTrigger render={<span className="cursor-default" />}>
																			<Badge variant="secondary" className="font-mono text-xs">
																				{latestVersion}
																			</Badge>
																		</TooltipTrigger>
																		<TooltipContent side="top">
																			Only available version
																		</TooltipContent>
																	</Tooltip>
																) : (
																	<Select
																		value={selectedVersions[pkg.name] ?? latestVersion ?? ""}
																		onValueChange={(v) => {
																			if (v) changeVersion(pkg.name, v);
																		}}
																	>
																		<SelectTrigger
																			className="h-6 w-auto gap-1 rounded-full border px-2 py-0 font-mono text-xs"
																			aria-label={`Version for ${pkg.name}`}
																		>
																			<SelectValue />
																		</SelectTrigger>
																		<SelectContent>
																			{availableVersions.map((v) => (
																				<SelectItem key={v} value={v} className="font-mono text-xs">
																					{v}
																					{v === latestVersion && (
																						<span className="text-muted-foreground ml-1">
																							(latest)
																						</span>
																					)}
																				</SelectItem>
																			))}
																		</SelectContent>
																	</Select>
																)}
															</td>
														</tr>
													);
												})}
										</tbody>
									</table>
								)}
							</div>
						</div>

						{/* ── Right: dependency preview ─────────────────────── */}
						<div className="flex min-h-0 min-w-0 flex-col px-6 py-5">
							{/* Header + controls */}
							<div className="mb-3 space-y-2">
								<div className="flex items-center justify-between">
									<h4 className="flex items-center gap-1 text-sm font-semibold">
										Dependency changes
										<Tooltip>
											<TooltipTrigger
												render={
													<CircleHelpIcon className="text-muted-foreground size-3.5 cursor-help" />
												}
											/>
											<TooltipContent side="bottom" className="max-w-xs text-xs">
												The left list shows the packages you chose to update. This panel shows all
												additional changes the solver needs to make — including transitive
												dependencies that will be upgraded, downgraded, added, or removed as a
												consequence.
											</TooltipContent>
										</Tooltip>
										{totalChanges > 0 && !previewStale && !previewLoading && (
											<Badge variant="secondary" className="ml-2 text-[10px]">
												{totalChanges}
											</Badge>
										)}
										{(previewStale || previewLoading) && preview && (
											<Badge variant="secondary" className="ml-2 text-[10px]">
												–
											</Badge>
										)}
									</h4>
									<div className="flex items-center gap-1.5">
										<Button
											variant="outline"
											size="sm"
											className="h-6 text-xs"
											onClick={runPreview}
											disabled={previewLoading || upgradableItems.length === 0}
											data-qa-id="environments-conda-update-confirm-preview-btn"
										>
											{previewLoading ? (
												<>
													<Spinner size="sm" />
													Resolving…
												</>
											) : previewStale && autoPreview ? (
												<>
													<span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
													Pending…
												</>
											) : (
												"Preview"
											)}
										</Button>
										<label className="flex cursor-pointer items-center gap-1 text-xs">
											<Checkbox
												checked={autoPreview}
												onCheckedChange={(v) => setAutoPreview(v === true)}
												className="size-3.5"
												aria-label="Auto preview"
												data-qa-id="environments-conda-update-confirm-auto-check"
											/>
											Auto
										</label>
									</div>
								</div>

								{/* Search + filters — visible once we've had at least one preview */}
								{preview && !preview.nothingToDo && (
									<>
										<div className="relative">
											<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
											<Input
												type="text"
												placeholder="Filter dependencies…"
												value={depSearch}
												onChange={(e) => setDepSearch(e.target.value)}
												className="h-7 pl-7 text-xs"
											/>
										</div>
										<div className="flex flex-wrap gap-1">
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
													value === "all"
														? totalChanges
														: (preview[value]?.filter(
																(c: CondaPackageChange) => !selectedPkgNames.has(c.name),
															).length ?? 0);
												const isResolving = previewLoading || previewStale;
												// While resolving, only show buttons that were visible
												// in the last completed preview.
												if (isResolving && !visibleCategories.has(value)) return null;
												// When not resolving, hide empty categories (except "all")
												if (!isResolving && value !== "all" && count === 0) return null;
												return (
													<Button
														key={value}
														variant={depFilter === value ? "default" : "outline"}
														size="sm"
														className="h-7 text-[10px]"
														onClick={() => setDepFilter(value)}
														data-qa-id={`environments-conda-update-confirm-filter-${value}`}
													>
														{label}
														<Badge variant="secondary" className="ml-1 text-[9px]">
															{isResolving ? "–" : count}
														</Badge>
													</Button>
												);
											})}
										</div>
									</>
								)}
							</div>

							{/* Loading state */}
							{previewLoading && (
								<div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-sm">
									<Spinner size="sm" />
									Resolving dependencies…
								</div>
							)}

							{/* Error */}
							{previewError && (
								<SolverErrorCard
									message={previewError.message}
									{...(previewError.detail ? { detail: previewError.detail } : {})}
									qaId="environments-conda-update-confirm-error"
								/>
							)}

							{/* Nothing to update — all selected packages are already up to date */}
							{upgradableItems.length === 0 && !previewLoading && (
								<div
									className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm"
									data-qa-id="environments-conda-update-confirm-nothing-selected"
								>
									<p className="font-medium">Nothing to update</p>
									<p className="max-w-xs text-xs">
										All selected packages are already at the latest available version.
									</p>
								</div>
							)}

							{/* No preview yet (shouldn't happen with auto-run) */}
							{upgradableItems.length > 0 && !preview && !previewLoading && !previewError && (
								<div className="text-muted-foreground flex flex-1 items-center justify-center text-center text-sm">
									<Spinner size="sm" className="mr-2" />
									Preparing preview…
								</div>
							)}

							{/* Nothing to do */}
							{preview && preview.nothingToDo && !previewStale && (
								<div
									className="text-muted-foreground flex flex-1 flex-col items-center justify-center gap-2 text-center text-sm"
									data-qa-id="environments-conda-update-confirm-nothing-to-do"
								>
									<p className="font-medium">Dependencies are already up to date</p>
									<p className="max-w-xs text-xs">
										The solver determined that the selected packages are already at the best
										compatible version for this environment. No changes to the dependencies are
										needed.
									</p>
								</div>
							)}

							{/* Stale overlay — blur previous preview, show refresh card */}
							{preview && previewStale && !previewLoading && !autoPreview && (
								<div
									className="relative min-h-0 flex-1"
									data-qa-id="environments-conda-update-confirm-stale"
								>
									<div className="pointer-events-none absolute inset-0 overflow-auto blur-sm">
										<PreviewContent
											sections={filteredSections}
											collapsed={collapsed}
											onToggleCollapse={toggleCollapse}
										/>
									</div>
									<div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-black/40">
										<div className="flex flex-col items-center gap-3 rounded-xl border bg-white px-6 py-5 shadow-lg dark:bg-zinc-900">
											<RefreshCwIcon className="text-muted-foreground size-6" />
											<p className="text-sm font-medium">Preview is outdated</p>
											<p className="text-muted-foreground max-w-[200px] text-center text-xs">
												Package selection changed. Refresh to see the updated dependency changes.
											</p>
											<Button
												size="sm"
												onClick={runPreview}
												data-qa-id="environments-conda-update-confirm-refresh-btn"
											>
												<RefreshCwIcon className="size-3.5" />
												Refresh preview
											</Button>
										</div>
									</div>
								</div>
							)}

							{/* Active preview content */}
							{preview && !preview.nothingToDo && !previewStale && !previewLoading && (
								<div
									className="min-h-0 flex-1 overflow-auto"
									data-qa-id="environments-conda-update-confirm-preview"
								>
									{totalChanges === 0 ? (
										<div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-center text-sm">
											<p className="font-medium">No additional changes needed</p>
											<p className="max-w-xs text-xs">
												Updating the selected packages does not require any transitive dependency
												changes. You're ready to proceed.
											</p>
										</div>
									) : (
										<>
											<PreviewContent
												sections={filteredSections}
												collapsed={collapsed}
												onToggleCollapse={toggleCollapse}
											/>
											<p className="text-muted-foreground mt-2 text-xs">
												{totalChanges} total {totalChanges === 1 ? "change" : "changes"}
											</p>
										</>
									)}
								</div>
							)}
						</div>
					</div>

					{/* Backup option — aligned to the right half, matching the grid above */}
					<div className="grid shrink-0 grid-cols-1 border-t md:grid-cols-[1fr_1fr]">
						<div className="hidden md:block" />
						<div className="px-6 py-3">
							<div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-900/50 dark:bg-blue-950/30">
								<div className="flex items-center gap-3">
									<CopyIcon className="text-muted-foreground size-4 shrink-0" />
									<div className="min-w-0 flex-1">
										<p className="text-sm font-medium">Back up before updating?</p>
										{!backup && (
											<p className="text-muted-foreground text-xs">
												Clone this environment so you can revert if needed.
											</p>
										)}
										{backup && (
											<div className="mt-1">
												<div className="flex items-center gap-2">
													<Label className="shrink-0 text-xs">Name:</Label>
													<Input
														value={backupName}
														onChange={(e) => setBackupName(e.target.value)}
														placeholder={`${targetName}-backup`}
														className={`h-7 text-xs ${backupNameError ? "border-red-400 focus-visible:ring-red-300" : ""}`}
														data-qa-id="environments-conda-update-confirm-backup-name"
													/>
												</div>
												{backupNameError && (
													<p className="mt-1 text-[11px] text-red-600 dark:text-red-400">
														{backupNameError}
													</p>
												)}
											</div>
										)}
									</div>
									<Checkbox
										checked={backup}
										onCheckedChange={(checked) => setBackup(checked === true)}
										className="size-5 shrink-0 border-2 border-blue-400 dark:border-blue-500"
										data-qa-id="environments-conda-update-confirm-backup-check"
									/>
								</div>
							</div>
						</div>
					</div>

					{/* Footer */}
					<div className="flex shrink-0 items-center justify-end gap-2 border-t px-6 py-4">
						<Button variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button
							onClick={handleSubmit}
							disabled={
								upgradableItems.length === 0 ||
								previewLoading ||
								!!previewError ||
								(backup && (!backupName.trim() || !!backupNameError))
							}
							data-qa-id="environments-conda-update-confirm-btn"
						>
							{backup
								? `Back up & Update ${upgradableItems.length} ${upgradableItems.length === 1 ? "Package" : "Packages"}`
								: `Update ${upgradableItems.length} ${upgradableItems.length === 1 ? "Package" : "Packages"}`}
						</Button>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
