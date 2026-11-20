import { useEffect, useRef, useState } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { FieldError } from "@kilo-desktop/ui/components/field";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { CondaEnv, CondaPackagesPreviewResult } from "../../../contracts/providers/conda";
import { useConda, useCondaMutation, useCondaQuery } from "../../conda";
import { ChannelChooserPopover } from "./ChannelChooserPopover";
import {
	ChangeFilterMenu,
	DependencyChangeList,
	SolverErrorCard,
	summarizeChanges,
	type ChangeFilter,
	type ChangeSummary,
} from "./DependencyPreview";
import { environmentDisplayName } from "./environment-display";
import {
	friendlyEnvironmentsError,
	type FriendlyEnvironmentsError,
} from "./environments-error-message";
import { installPackagesJob, showJobSuccess, useJobToasts } from "./environments-toasts";
import {
	PackageResultsTable,
	PackageSearchInput,
	PanelSectionHeading,
	SelectedPackagesPane,
	selectedPackageToSpec,
	usePackageSelection,
	type PackageInstallPreset,
} from "./PackageSearch";
import { useChannelSelection } from "./use-channel-selection";
import { useTrackPolicyFailure } from "./use-track-policy-failure";
import { usePackageSearch } from "./use-package-search";

interface AddPackageDialogProps {
	env: CondaEnv;
	open: boolean;
	onClose: () => void;
	/** Opens with these packages selected and channels added; read on mount. */
	preset?: PackageInstallPreset;
	/** Called when an install finishes while the dialog is open, before it closes. */
	onInstalled?: () => void;
}

/** Wait this long after the last selection change before asking the solver. */
export const PREVIEW_DEBOUNCE_MS = 1500;

/**
 * Search the configured channels and add packages to an existing
 * environment. Shares the package search, results table and selected-package
 * pane with Create environment; below the selection, a solver preview lists
 * the transitive dependency changes the install would make.
 */
export function AddPackageDialog({
	env,
	open,
	onClose,
	preset,
	onInstalled,
}: AddPackageDialogProps) {
	const conda = useConda();
	const trackPolicyFailure = useTrackPolicyFailure();
	const { jobToastOptions, showJobError } = useJobToasts();
	const install = useCondaMutation(conda, "installPackages", {
		invalidates: ["listPackages", "findRepodata"],
	});

	const targetName = env.name || "base";
	const displayName = environmentDisplayName(env);
	const [query, setQuery] = useState(() => preset?.packages[0]?.name ?? "");
	const selection = usePackageSelection(preset?.packages);
	const { selected } = selection;

	const prefixQuery = useCondaQuery(conda, "prefixOptions");
	const channels = useChannelSelection(prefixQuery.data?.channels, preset?.channels);
	const search = usePackageSearch({
		conda,
		open,
		ready: !prefixQuery.isPending,
		query,
		channels: channels.channelsArg,
	});

	// Installed packages for this env — matching rows show their installed
	// version and cannot be selected.
	const installedQuery = useCondaQuery(conda, "listPackages", {
		name: env.name || undefined,
		prefix: env.prefix,
	});
	const installedByName = new Map(
		(installedQuery.data?.packages ?? []).map((p) => [p.name, p.version]),
	);

	// ─── Install preview ─────────────────────────────────────────────
	const [preview, setPreview] = useState<CondaPackagesPreviewResult | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [previewError, setPreviewError] = useState<FriendlyEnvironmentsError | null>(null);
	const [depFilter, setDepFilter] = useState<ChangeFilter>("all");
	const previewGenRef = useRef(0);
	const lastSolveKeyRef = useRef("");
	const previewRef = useRef<CondaPackagesPreviewResult | null>(null);
	const previewErrorRef = useRef<FriendlyEnvironmentsError | null>(null);
	// Key of the selection+channels the current `preview` was solved for. Install
	// eligibility compares this against the live `solveKey` so a preview can only
	// unlock the button for the exact specs and channels the solver validated.
	const [solvedKey, setSolvedKey] = useState("");

	// The solve identity: the solver resolves against both the package specs and
	// the selected channels, so a channel toggle must invalidate a prior solve
	// just like a spec change. Keying on specs alone would leave Install enabled
	// against channels the solver never saw.
	const solveKey = `${selected.map(selectedPackageToSpec).join(",")}|${(channels.channelsArg ?? []).join(",")}`;

	const runPreview = () => {
		if (selected.length === 0) return;
		const specs = selected.map(selectedPackageToSpec);
		if (solveKey === lastSolveKeyRef.current && previewRef.current && !previewErrorRef.current)
			return;
		lastSolveKeyRef.current = solveKey;
		const gen = ++previewGenRef.current;
		setPreviewLoading(true);
		setPreviewError(null);
		previewErrorRef.current = null;
		conda
			.previewInstall({
				name: targetName,
				prefix: env.prefix,
				packages: specs,
				channels: channels.channelsArg,
			})
			.then((result) => {
				if (gen !== previewGenRef.current) return;
				const typed = result as CondaPackagesPreviewResult;
				previewRef.current = typed;
				setSolvedKey(solveKey);
				setPreview(typed);
			})
			.catch((reason) => {
				if (gen !== previewGenRef.current) return;
				const err = friendlyEnvironmentsError(reason, "Could not preview the install.");
				trackPolicyFailure(reason);
				previewErrorRef.current = err;
				setPreviewError(err);
				previewRef.current = null;
				setPreview(null);
			})
			.finally(() => {
				if (gen === previewGenRef.current) setPreviewLoading(false);
			});
	};

	// Drop the previous solution as soon as the dialog closes or the selection
	// or channels change, so the install button re-locks until the solver
	// re-solves the new specs — otherwise it would stay enabled against a stale
	// solve during the debounce window.
	const previewKey = open && selected.length > 0 ? solveKey : null;
	const [shownPreviewKey, setShownPreviewKey] = useState(previewKey);
	if (shownPreviewKey !== previewKey) {
		setShownPreviewKey(previewKey);
		setPreview(null);
		setPreviewError(null);
	}

	// Auto-preview when the selection changes — debounced so rapid clicks
	// don't fire a solver request per toggle.
	useEffect(() => {
		if (!open || selected.length === 0) {
			lastSolveKeyRef.current = "";
			return;
		}
		// Bumping the generation invalidates any solve still in flight for the
		// old key, so a late-landing result for a superseded selection cannot
		// unlock Install for the new, unvalidated one.
		if (solveKey !== lastSolveKeyRef.current) {
			previewGenRef.current += 1;
			previewRef.current = null;
			previewErrorRef.current = null;
		}
		const timer = setTimeout(runPreview, PREVIEW_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [open, selected, solveKey, runPreview]);

	const selectedNames = new Set(selected.map((s) => s.name));
	const changes = summarizeChanges(preview, selectedNames, depFilter);

	// The install button stays locked until the solver returns a usable
	// solution: a preview result must exist for the current solve key with no
	// solver error and nothing in flight. Requiring `solvedKey` to match the
	// live `solveKey` ignores a solve for an older key that lands before the
	// effect bumps the generation, so the button cannot
	// enable for a selection/channel set the solver has not validated. A
	// SOLVE_FAILED preview (previewError) or an unresolved/loading solve also
	// leaves the button disabled.
	const solverSolved =
		preview !== null && !previewError && !previewLoading && solvedKey === solveKey;
	const canInstall = !install.isPending && selected.length > 0 && solverSolved;

	// The in-flight install job, so "Run in background" can adopt it.
	// `backgrounded` mutes the foreground handlers.
	const pendingInstallRef = useRef<{
		promise: Promise<unknown>;
		count: number;
		backgrounded: boolean;
	} | null>(null);

	function resetForm() {
		selection.reset();
		setQuery("");
		channels.reset();
		setPreview(null);
		setPreviewLoading(false);
		setPreviewError(null);
		setDepFilter("all");
		lastSolveKeyRef.current = "";
		setSolvedKey("");
		previewGenRef.current = 0;
		previewRef.current = null;
		previewErrorRef.current = null;
		pendingInstallRef.current = null;
		install.reset();
	}

	function handleInstall() {
		if (selected.length === 0) return;
		const specs = selected.map(selectedPackageToSpec);
		const count = specs.length;
		const job = installPackagesJob(displayName, count);
		const promise = install.mutateAsync({
			name: targetName,
			prefix: env.prefix,
			packages: specs,
			channels: channels.channelsArg,
		});
		const pending = { promise, count, backgrounded: false };
		pendingInstallRef.current = pending;
		promise.then(
			() => {
				if (pending.backgrounded) return;
				showJobSuccess(job);
				resetForm();
				onInstalled?.();
				onClose();
			},
			(reason) => {
				if (!pending.backgrounded) showJobError(job, reason);
			},
		);
	}

	function handleRunInBackground() {
		const pending = pendingInstallRef.current;
		if (!pending) return;
		pending.backgrounded = true;
		toast.promise(pending.promise, jobToastOptions(installPackagesJob(displayName, pending.count)));
		resetForm();
		onClose();
	}

	function handleOpenChange(next: boolean) {
		if (next) return;
		// A running install moves to the background instead of blocking close.
		if (install.isPending) {
			handleRunInBackground();
			return;
		}
		resetForm();
		onClose();
	}

	const installLabel = `Install ${selected.length} ${selected.length === 1 ? "package" : "packages"}`;

	return (
		<>
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogContent
					data-qa-id="environments-conda-add-pkg-dialog"
					className="h-[min(48rem,calc(100dvh-4rem))] grid-rows-[minmax(0,1fr)_auto] gap-0 sm:max-w-6xl"
				>
					<div
						className={cn(
							"-mx-4 -mt-4 grid min-h-0",
							selected.length > 0
								? "grid-rows-[minmax(0,1fr)_minmax(0,14rem)] md:grid-cols-[minmax(0,1fr)_22rem] md:grid-rows-1"
								: "grid-cols-[minmax(0,1fr)]",
						)}
					>
						<div className="flex min-h-0 min-w-0 flex-col gap-4 p-4">
							<DialogHeader>
								<DialogTitle>Add packages to {displayName}</DialogTitle>
								<DialogDescription>
									Search the selected channels and pick the packages to install.
								</DialogDescription>
							</DialogHeader>
							<div className="flex shrink-0 items-center gap-2">
								<PackageSearchInput
									value={query}
									onChange={setQuery}
									qaId="environments-conda-add-pkg-search"
								/>
								<ChannelChooserPopover
									open={channels.open}
									onOpenChange={channels.setOpen}
									summary={channels.summary}
									customized={channels.customized}
									qaId="environments-conda-add-pkg-channels-btn"
									availableChannels={channels.available}
									linkChannels={channels.linkChannels}
									selectedChannels={channels.selected}
									onToggle={channels.toggle}
								/>
							</div>
							<PackageResultsTable
								search={search}
								query={query}
								selection={selection}
								installedByName={installedByName}
								disabled={install.isPending}
								qaPrefix="environments-conda-add-pkg"
							/>
						</div>

						{selected.length > 0 ? (
							<SelectedPackagesPane selection={selection} qaPrefix="environments-conda-add-pkg">
								<DependencyChangesSection
									preview={preview}
									loading={previewLoading}
									error={previewError}
									changes={changes}
									filter={depFilter}
									onFilterChange={setDepFilter}
									onRetry={runPreview}
								/>
							</SelectedPackagesPane>
						) : null}
					</div>

					<DialogFooter className="sm:items-center">
						{install.isError ? (
							<FieldError className="sm:mr-auto" data-qa-id="environments-conda-add-pkg-error">
								{
									friendlyEnvironmentsError(
										install.error,
										"Could not install the selected packages.",
									).message
								}
							</FieldError>
						) : null}
						{install.isPending ? (
							<Button
								type="button"
								variant="ghost"
								className="sm:mr-auto"
								onClick={handleRunInBackground}
								data-qa-id="environments-conda-add-pkg-background"
							>
								Run in background
							</Button>
						) : null}
						<Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={handleInstall}
							disabled={!canInstall}
							data-qa-id="environments-conda-add-pkg-install-btn"
						>
							{install.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
							{install.isPending ? "Installing…" : installLabel}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}

/**
 * The solver's other changes for the current selection, as a second section
 * of the selected-packages panel: status line while resolving or on a no-op,
 * the solver error card on failure, otherwise the grouped change list.
 */
function DependencyChangesSection({
	preview,
	loading,
	error,
	changes,
	filter,
	onFilterChange,
	onRetry,
}: {
	preview: CondaPackagesPreviewResult | null;
	loading: boolean;
	error: FriendlyEnvironmentsError | null;
	changes: ChangeSummary;
	filter: ChangeFilter;
	onFilterChange: (filter: ChangeFilter) => void;
	onRetry: () => void;
}) {
	const resolved = preview !== null && !loading && !error;
	const categoryCount = Object.values(changes.counts).filter((count) => count > 0).length;
	return (
		<section
			aria-labelledby="environments-conda-add-pkg-preview-heading"
			data-qa-id="environments-conda-add-pkg-preview"
		>
			<PanelSectionHeading
				id="environments-conda-add-pkg-preview-heading"
				count={resolved && changes.total > 0 ? changes.total : undefined}
				countQaId="environments-conda-add-pkg-preview-count"
				action={
					resolved && (categoryCount > 1 || filter !== "all") ? (
						<ChangeFilterMenu
							value={filter}
							onChange={onFilterChange}
							counts={changes.counts}
							total={changes.total}
							qaPrefix="environments-conda-add-pkg-preview"
						/>
					) : null
				}
			>
				Dependency changes
			</PanelSectionHeading>
			{error ? (
				<div className="px-4">
					<SolverErrorCard
						error={error}
						qaId="environments-conda-add-pkg-preview-error"
						onRetry={onRetry}
					/>
				</div>
			) : !resolved ? (
				<p className="text-muted-foreground flex items-center gap-2 px-4 py-1.5 text-xs">
					<Spinner aria-hidden="true" />
					Resolving dependencies…
				</p>
			) : preview.nothingToDo || changes.total === 0 ? (
				<p className="text-muted-foreground px-4 py-1.5 text-xs">No other packages change.</p>
			) : (
				<div className="px-4">
					<DependencyChangeList
						sections={changes.sections}
						qaId="environments-conda-add-pkg-preview-list"
					/>
				</div>
			)}
		</section>
	);
}
