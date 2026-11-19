import { useEffect, useRef, useState, type ReactNode } from "react";

import { ArrowRightIcon, SearchIcon } from "lucide-react";

import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@kilo-desktop/ui/components/button";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { Empty, EmptyHeader, EmptyTitle } from "@kilo-desktop/ui/components/empty";
import {
	Field,
	FieldContent,
	FieldDescription,
	FieldError,
	FieldLabel,
} from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
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
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@kilo-desktop/ui/components/table";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type {
	CondaEnv,
	CondaPackage,
	CondaPackagesPreviewResult,
} from "../../../contracts/providers/conda";
import { condaQueryKey, useConda, useCondaMutation, useCondaQuery } from "../../conda";
import { environmentDisplayName, validateEnvironmentName } from "./environment-display";
import { useTrackPolicyFailure } from "./use-track-policy-failure";
import {
	friendlyEnvironmentsError,
	type FriendlyEnvironmentsError,
} from "./environments-error-message";
import { backupEnvironmentJob, jobToastOptions, updatePackagesJob } from "./environments-toasts";
import {
	ChangeFilterMenu,
	DependencyChangeList,
	SolverErrorCard,
	summarizeChanges,
	type ChangeCategory,
	type ChangeFilter,
} from "./DependencyPreview";
import { PackageSearchInput, PanelSectionHeading } from "./PackageSearch";

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

/** Marks a backup failure so the job toast can offer "Update anyway". */
class BackupFailedError extends Error {
	constructor(readonly reason: unknown) {
		super("Backup failed");
	}
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

let updateJobSequence = 0;

export function packagesLabel(count: number): string {
	return `${count} ${count === 1 ? "package" : "packages"}`;
}

function useExistingEnvironmentNames(conda: ReturnType<typeof useConda>): ReadonlySet<string> {
	const envList = useCondaQuery(conda, "listEnvironments");
	return new Set((envList.data ?? []).map((e) => e.name).filter(Boolean));
}

/** Which updatable packages are checked (included in the update). */
function useCheckedPackages(items: readonly UpgradablePackage[]) {
	// Names of packages that can actually be updated (drives the header
	// select-all checkbox; up-to-date rows have no checkbox).
	const updatableNames = items.filter((u) => u.latestVersion !== null).map((u) => u.pkg.name);
	const [checkedPkgs, setCheckedPkgs] = useState<Set<string>>(() => new Set(updatableNames));
	const allChecked =
		updatableNames.length > 0 && updatableNames.every((name) => checkedPkgs.has(name));
	const someChecked = !allChecked && updatableNames.some((name) => checkedPkgs.has(name));
	return { updatableNames, checkedPkgs, setCheckedPkgs, allChecked, someChecked };
}

/** Format check + uniqueness check against existing envs. */
function backupNameErrorFor(backupName: string, existingEnvNames: ReadonlySet<string>) {
	const trimmed = backupName.trim();
	if (!trimmed) return null; // Don't show error for empty — the submit button handles that
	const formatError = validateEnvironmentName(trimmed);
	if (formatError) return formatError;
	if (existingEnvNames.has(trimmed)) {
		return `An environment named "${trimmed}" already exists. Choose a different name.`;
	}
	return null;
}

export function UpdateConfirmationDialog({
	env,
	upgradablePackages,
	open,
	onClose,
	onSuccess,
	onUpdatingChange,
}: UpdateConfirmationDialogProps) {
	const conda = useConda();
	const trackPolicyFailure = useTrackPolicyFailure();
	const queryClient = useQueryClient();
	const existingEnvNames = useExistingEnvironmentNames(conda);
	const cloneMutation = useCondaMutation(conda, "cloneEnvironment", {
		invalidates: ["listEnvironments"],
	});

	const items = upgradablePackages;
	const { updatableNames, checkedPkgs, setCheckedPkgs, allChecked, someChecked } =
		useCheckedPackages(items);
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

	// Preview state
	const [preview, setPreview] = useState<CondaPackagesPreviewResult | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [previewError, setPreviewError] = useState<FriendlyEnvironmentsError | null>(null);
	const [previewStale, setPreviewStale] = useState(false);

	const [pkgSearch, setPkgSearch] = useState("");
	const [depSearch, setDepSearch] = useState("");
	const [depFilter, setDepFilter] = useState<ChangeFilter>("all");
	// Categories offered by the last completed preview, so loading/stale
	// states don't add or remove filter toggles mid-resolve.
	const [visibleCategories, setVisibleCategories] = useState<Set<ChangeCategory>>(new Set());

	const targetName = env.name || "base";
	const displayName = environmentDisplayName(env);

	// Stable ref for the current item names — used to dedupe preview calls
	const itemNamesRef = useRef<string>("");
	const previewGenRef = useRef(0);
	const previewRef = useRef<CondaPackagesPreviewResult | null>(null);
	const previewStaleRef = useRef(false);

	// Only checked packages with an available update are sent to the solver.
	const upgradableItems = items.filter(
		(u) => u.latestVersion !== null && checkedPkgs.has(u.pkg.name),
	);

	// Packages chosen on the left are excluded from the dependency panel so
	// it only shows transitive (indirect) changes.
	const selectedPkgNames = new Set(items.map((u) => u.pkg.name));

	const runPreview = () => {
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
		conda
			.previewUpdate({
				name: targetName,
				prefix: env.prefix,
				packages: specs,
			})
			.then((result) => {
				if (gen !== previewGenRef.current) return;
				const prev = result as CondaPackagesPreviewResult;
				setPreview(prev);
				previewRef.current = prev;
				const { counts } = summarizeChanges(prev, selectedPkgNames);
				setVisibleCategories(
					new Set(
						(Object.keys(counts) as ChangeCategory[]).filter((category) => counts[category] > 0),
					),
				);
			})
			.catch((reason) => {
				if (gen !== previewGenRef.current) return;
				setPreviewError(friendlyEnvironmentsError(reason, "Could not preview the update."));
				trackPolicyFailure(reason);
				setPreview(null);
				previewRef.current = null;
			})
			.finally(() => {
				if (gen === previewGenRef.current) setPreviewLoading(false);
			});
	};

	// Reset on open
	const [wasOpen, setWasOpen] = useState(false);
	if (wasOpen !== open) {
		setWasOpen(open);
		if (open) {
			setCheckedPkgs(new Set(updatableNames));
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
			setPkgSearch("");
			setDepSearch("");
			setDepFilter("all");
		}
	}
	useEffect(() => {
		if (open) {
			itemNamesRef.current = "";
			previewGenRef.current = 0;
			previewRef.current = null;
			previewStaleRef.current = false;
		}
	}, [open]);

	// Trigger initial preview after items are set
	useEffect(() => {
		if (open && items.length > 0 && !preview && !previewLoading && !previewError) {
			runPreview();
		}
	}, [open, items.length, preview, previewLoading, previewError, runPreview]);

	function markStale() {
		setPreviewStale(true);
		previewStaleRef.current = true;
		setPreviewError(null);
	}

	function togglePackage(name: string) {
		setCheckedPkgs((prev) => {
			const next = new Set(prev);
			if (next.has(name)) next.delete(name);
			else next.add(name);
			return next;
		});
		markStale();
	}

	function changeVersion(name: string, version: string) {
		setSelectedVersions((prev) => ({ ...prev, [name]: version }));
		markStale();
	}

	// Re-solve once edits pause for 2 s, so a burst of changes costs one solve.
	useEffect(() => {
		if (!open || !previewStale || previewLoading) return;
		const timer = setTimeout(runPreview, 2000);
		return () => clearTimeout(timer);
	}, [open, previewStale, previewLoading, runPreview]);

	const backupNameError = backup ? backupNameErrorFor(backupName, existingEnvNames) : null;

	function toggleAllPackages() {
		setCheckedPkgs(allChecked ? new Set() : new Set(updatableNames));
		markStale();
	}

	const changes = summarizeChanges(preview, selectedPkgNames, depFilter, depSearch);
	const totalChanges = changes.total;

	const needle = pkgSearch.trim().toLowerCase();
	const visibleItems = needle
		? items.filter((u) => u.pkg.name.toLowerCase().includes(needle))
		: items;

	// ─── Background operations ─────────────────────────────────────────

	function invalidatePackages() {
		void queryClient.invalidateQueries({ queryKey: condaQueryKey("listPackages") });
		void queryClient.invalidateQueries({ queryKey: condaQueryKey("findRepodata") });
	}

	function runUpdate(packageSpecs: string[], toastId: string) {
		const count = packageSpecs.length;
		onUpdatingChange?.(count);
		const job = conda
			.updatePackages({
				name: targetName,
				prefix: env.prefix,
				packages: packageSpecs,
			})
			.then(invalidatePackages)
			.finally(() => onUpdatingChange?.(-count));
		toast.promise(job, jobToastOptions(updatePackagesJob(displayName, count), toastId));
	}

	function runBackupThenUpdate(packageSpecs: string[], cloneName: string, toastId: string) {
		const count = packageSpecs.length;
		const backupJob = backupEnvironmentJob(displayName, cloneName);
		const updateJob = updatePackagesJob(displayName, count);
		onUpdatingChange?.(count);
		const job = (async () => {
			try {
				await cloneMutation.mutateAsync({
					sourceName: targetName,
					sourcePrefix: env.prefix,
					name: cloneName,
				});
			} catch (reason) {
				throw new BackupFailedError(reason);
			}
			toast.loading(updateJob.loading, {
				id: toastId,
				description: `Backup complete. Resolving dependencies for ${displayName}.`,
			});
			await conda.updatePackages({
				name: targetName,
				prefix: env.prefix,
				packages: packageSpecs,
			});
			invalidatePackages();
		})().finally(() => onUpdatingChange?.(-count));

		const updateOptions = jobToastOptions(updateJob, toastId);
		const backupOptions = jobToastOptions(backupJob, toastId);
		toast.promise(job, {
			...updateOptions,
			loading: backupOptions.loading,
			description: backupJob.loadingDescription,
			error: (reason: unknown) => {
				if (!(reason instanceof BackupFailedError)) return updateOptions.error(reason);
				let retried = false;
				return {
					...backupOptions.error(reason.reason),
					action: {
						label: "Update anyway",
						onClick: () => {
							if (retried) return;
							retried = true;
							runUpdate(packageSpecs, toastId);
						},
					},
				};
			},
		});
	}

	function handleSubmit() {
		if (upgradableItems.length === 0) return;
		const specs = buildUpdateSpecs(upgradableItems, selectedVersions);
		updateJobSequence += 1;
		const toastId = `environments-update-${updateJobSequence}`;
		onClose();
		onSuccess();
		if (backup && backupName.trim()) {
			runBackupThenUpdate(specs, backupName.trim(), toastId);
		} else {
			runUpdate(specs, toastId);
		}
	}

	// ─── Render ────────────────────────────────────────────────────────

	const resolving = previewLoading || previewStale;
	const submitLabel = `${backup ? "Back up and update" : "Update"} ${packagesLabel(upgradableItems.length)}`;

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onClose();
			}}
		>
			<DialogContent
				data-qa-id="environments-conda-update-confirm-dialog"
				className="h-[min(48rem,calc(100dvh-4rem))] grid-rows-[minmax(0,1fr)_auto] gap-0 sm:max-w-6xl"
			>
				<div className="-mx-4 -mt-4 grid min-h-0 grid-rows-[minmax(0,1fr)_minmax(0,16rem)] md:grid-cols-[minmax(0,1fr)_22rem] md:grid-rows-1">
					<section
						className="flex min-h-0 min-w-0 flex-col gap-4 p-4"
						aria-label="Packages to update"
					>
						<DialogHeader>
							<DialogTitle>
								Update {packagesLabel(upgradableItems.length)} in {displayName}
							</DialogTitle>
							<DialogDescription>
								Review the versions to install and the dependency changes they bring. Clear any
								package you want to skip.
							</DialogDescription>
						</DialogHeader>
						<div className="flex shrink-0 items-center gap-2">
							<PackageSearchInput
								value={pkgSearch}
								onChange={setPkgSearch}
								qaId="environments-conda-update-confirm-search"
							/>
						</div>
						{items.length === 0 ? (
							<Empty className="border">
								<EmptyHeader>
									<EmptyTitle>No packages to update</EmptyTitle>
								</EmptyHeader>
							</Empty>
						) : (
							<div className="border-border flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
								<div className="scroll-fade-y min-h-0 overflow-y-auto">
									<Table className="table-fixed">
										<TableHeader>
											<TableRow>
												<TableHead scope="col" className="w-9">
													{updatableNames.length > 0 && (
														<Checkbox
															checked={allChecked}
															indeterminate={someChecked}
															onCheckedChange={toggleAllPackages}
															aria-label={
																allChecked ? "Unselect all packages" : "Select all packages"
															}
															data-qa-id="environments-conda-update-confirm-select-all"
														/>
													)}
												</TableHead>
												<TableHead scope="col">Package</TableHead>
												<TableHead scope="col" className="w-[22%]">
													Current
												</TableHead>
												<TableHead scope="col" className="w-6">
													<span className="sr-only">To</span>
												</TableHead>
												<TableHead scope="col" className="w-[30%]">
													New
												</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{visibleItems.map(({ pkg, latestVersion, availableVersions }) => (
												<TableRow
													key={pkg.name}
													data-state={
														latestVersion && checkedPkgs.has(pkg.name) ? "selected" : undefined
													}
												>
													<TableCell>
														{latestVersion ? (
															<Checkbox
																checked={checkedPkgs.has(pkg.name)}
																onCheckedChange={() => togglePackage(pkg.name)}
																aria-label={`Include ${pkg.name} in update`}
															/>
														) : null}
													</TableCell>
													<TableCell className="truncate font-medium">{pkg.name}</TableCell>
													<TableCell className="text-muted-foreground truncate">
														{pkg.version}
													</TableCell>
													<TableCell>
														{latestVersion ? (
															<ArrowRightIcon
																className="text-muted-foreground size-3"
																aria-hidden="true"
															/>
														) : null}
													</TableCell>
													<TableCell>
														{!latestVersion ? (
															<FixedVersionCell muted>up to date</FixedVersionCell>
														) : availableVersions.length <= 1 ? (
															<FixedVersionCell>{latestVersion}</FixedVersionCell>
														) : (
															<Select
																value={selectedVersions[pkg.name] ?? latestVersion}
																onValueChange={(v) => {
																	if (v) changeVersion(pkg.name, v);
																}}
															>
																<SelectTrigger
																	size="sm"
																	className="w-full"
																	aria-label={`Version for ${pkg.name}`}
																>
																	<SelectValue />
																</SelectTrigger>
																<SelectContent>
																	{availableVersions.map((v) => (
																		<SelectItem key={v} value={v}>
																			{v}
																			{v === latestVersion ? (
																				<span className="text-muted-foreground">(latest)</span>
																			) : null}
																		</SelectItem>
																	))}
																</SelectContent>
															</Select>
														)}
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							</div>
						)}
						<Field orientation="horizontal">
							<Checkbox
								id="environments-update-backup"
								checked={backup}
								onCheckedChange={(checked) => setBackup(checked === true)}
								data-qa-id="environments-conda-update-confirm-backup-check"
							/>
							<FieldContent>
								<FieldLabel htmlFor="environments-update-backup">
									Back up before updating
								</FieldLabel>
								<FieldDescription>
									Clone this environment first so you can go back to it if needed.
								</FieldDescription>
							</FieldContent>
						</Field>
						{backup ? (
							<Field data-invalid={backupNameError ? true : undefined}>
								<FieldLabel htmlFor="environments-update-backup-name">Backup name</FieldLabel>
								<Input
									id="environments-update-backup-name"
									value={backupName}
									onChange={(e) => setBackupName(e.target.value)}
									placeholder={`${targetName}-backup`}
									aria-invalid={backupNameError ? true : undefined}
									data-qa-id="environments-conda-update-confirm-backup-name"
								/>
								{backupNameError ? <FieldError>{backupNameError}</FieldError> : null}
							</Field>
						) : null}
					</section>

					<aside
						className="bg-background/60 border-border flex min-h-0 min-w-0 flex-col border-t md:border-t-0 md:border-l"
						aria-labelledby="environments-conda-update-confirm-changes-heading"
					>
						<div className="scroll-fade-y min-h-0 flex-1 overflow-y-auto pb-4">
							<PanelSectionHeading
								id="environments-conda-update-confirm-changes-heading"
								count={preview && !preview.nothingToDo && !resolving ? totalChanges : undefined}
							>
								Dependency changes
							</PanelSectionHeading>
							<div className="flex flex-col gap-3 px-4">
								{preview && !preview.nothingToDo ? (
									<div className="flex items-center gap-2">
										<InputGroup className="min-w-0 flex-1">
											<InputGroupInput
												type="search"
												placeholder="Search dependencies"
												aria-label="Search dependencies"
												value={depSearch}
												onChange={(e) => setDepSearch(e.currentTarget.value)}
											/>
											<InputGroupAddon>
												<SearchIcon aria-hidden="true" />
											</InputGroupAddon>
										</InputGroup>
										<ChangeFilterMenu
											value={depFilter}
											onChange={setDepFilter}
											counts={changes.counts}
											total={totalChanges}
											resolving={resolving}
											{...(resolving ? { categories: visibleCategories } : {})}
											size="icon"
											qaPrefix="environments-conda-update-confirm"
										/>
									</div>
								) : null}

								{previewError ? (
									<SolverErrorCard
										error={previewError}
										qaId="environments-conda-update-confirm-error"
										onRetry={runPreview}
									/>
								) : null}

								{upgradableItems.length === 0 && !previewLoading ? (
									<PanelStatus qaId="environments-conda-update-confirm-nothing-selected">
										Nothing to update. Select a package to preview its dependency changes.
									</PanelStatus>
								) : previewLoading ||
								  previewStale ||
								  (upgradableItems.length > 0 && !preview && !previewError) ? (
									<PanelStatus>
										<Spinner aria-hidden="true" />
										Resolving dependencies…
									</PanelStatus>
								) : preview && preview.nothingToDo && !previewStale ? (
									<PanelStatus qaId="environments-conda-update-confirm-nothing-to-do">
										Already at the best compatible versions. No dependency changes needed.
									</PanelStatus>
								) : preview && !preview.nothingToDo && !previewStale ? (
									<div data-qa-id="environments-conda-update-confirm-preview">
										{totalChanges === 0 ? (
											<PanelStatus>No other packages change.</PanelStatus>
										) : (
											<DependencyChangeList sections={changes.sections} />
										)}
									</div>
								) : null}
							</div>
						</div>
					</aside>
				</div>

				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose}>
						Cancel
					</Button>
					<Button
						type="button"
						onClick={handleSubmit}
						disabled={
							upgradableItems.length === 0 ||
							previewLoading ||
							!!previewError ||
							(backup && (!backupName.trim() || !!backupNameError))
						}
						data-qa-id="environments-conda-update-confirm-btn"
					>
						{submitLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function PanelStatus({ children, qaId }: { children: ReactNode; qaId?: string }) {
	return (
		<p className="text-muted-foreground flex items-center gap-2 py-1.5 text-xs" data-qa-id={qaId}>
			{children}
		</p>
	);
}

/**
 * Plain-text stand-in for the version picker when there is nothing to pick,
 * boxed like a small Select trigger so text aligns and row heights match.
 */
function FixedVersionCell({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
	return (
		<span
			className={cn(
				"flex h-7 items-center truncate border border-transparent pl-2.5 text-sm",
				muted && "text-muted-foreground",
			)}
		>
			{children}
		</span>
	);
}
