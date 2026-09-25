import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAnacondaSignIn, useSdk, useSdkMutation, useSdkQuery } from "@kilo-desktop/sdk-react";
import { AnacondaSignInDialog } from "@kilo-desktop/ui/components/anaconda-sign-in-dialog";
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

import type {
	CondaEnv,
	CondaPackagesPreviewResult,
	CondaService,
} from "../../../contracts/providers/conda.js";
import { parseEnvironmentsErrorMessage } from "../../../contracts/common.js";
import { ChannelChooserPopover } from "./ChannelChooserPopover.js";
import {
	ChangeFilterMenu,
	DependencyChangeList,
	SolverErrorCard,
	summarizeChanges,
	type ChangeFilter,
	type ChangeSummary,
} from "./DependencyPreview.js";
import { environmentDisplayName } from "./environment-display.js";
import { friendlyEnvironmentsError } from "./environments-error-message.js";
import {
	installPackagesJob,
	jobToastOptions,
	showJobError,
	showJobSuccess,
} from "./environments-toasts.js";
import {
	PackageResultsTable,
	PackageSearchInput,
	PanelSectionHeading,
	SelectedPackagesPane,
	selectedPackageToSpec,
	usePackageSelection,
} from "./PackageSearch.js";
import { useChannelSelection } from "./use-channel-selection.js";
import { usePackageSearch } from "./use-package-search.js";

interface AddPackageDialogProps {
	env: CondaEnv;
	open: boolean;
	onClose: () => void;
}

/** Wait this long after the last selection change before asking the solver. */
const PREVIEW_DEBOUNCE_MS = 1500;

/**
 * Search the configured channels and add packages to an existing
 * environment. Shares the package search, results table and selected-package
 * pane with Create environment; below the selection, a solver preview lists
 * the transitive dependency changes the install would make.
 */
export function AddPackageDialog({ env, open, onClose }: AddPackageDialogProps) {
	const sdk = useSdk<CondaService>("environments");
	const signIn = useAnacondaSignIn(sdk);
	const install = useSdkMutation(sdk, "conda.packages.install", {
		invalidates: ["conda.packages.list", "conda.repodata.find"],
	});

	const targetName = env.name || "base";
	const displayName = environmentDisplayName(env);
	const [query, setQuery] = useState("");
	const selection = usePackageSelection();
	const { selected } = selection;

	const prefixQuery = useSdkQuery(sdk, "conda.envs.prefixOptions");
	const channels = useChannelSelection(prefixQuery.data?.channels, signIn);
	const search = usePackageSearch({
		sdk,
		open,
		ready: !prefixQuery.isPending,
		query,
		channels: channels.channelsArg,
	});

	// Installed packages for this env — matching rows show their installed
	// version and cannot be selected.
	const installedQuery = useSdkQuery(sdk, "conda.packages.list", {
		name: env.name || undefined,
		prefix: env.prefix,
	});
	const installedByName = useMemo(
		() => new Map((installedQuery.data?.packages ?? []).map((p) => [p.name, p.version])),
		[installedQuery.data?.packages],
	);

	// ─── Install preview ─────────────────────────────────────────────
	const [preview, setPreview] = useState<CondaPackagesPreviewResult | null>(null);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [previewError, setPreviewError] = useState<{ message: string; detail?: string } | null>(
		null,
	);
	const [depFilter, setDepFilter] = useState<ChangeFilter>("all");
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
				channels: channels.channelsArg,
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
	}, [selected, targetName, env.prefix, channels.channelsArg, sdk]);

	// Auto-preview when the selection changes — debounced so rapid clicks
	// don't fire a solver request per toggle.
	useEffect(() => {
		if (!open || selected.length === 0) {
			setPreview(null);
			setPreviewError(null);
			lastSpecsKeyRef.current = "";
			return;
		}
		const timer = setTimeout(runPreview, PREVIEW_DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [open, selected, runPreview]);

	const selectedNames = useMemo(() => new Set(selected.map((s) => s.name)), [selected]);
	const changes = useMemo(
		() => summarizeChanges(preview, selectedNames, depFilter),
		[preview, selectedNames, depFilter],
	);

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
		lastSpecsKeyRef.current = "";
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
									selectedChannels={channels.selected}
									onToggle={channels.toggle}
									signedIn={signIn.authenticated}
									onRequestSignIn={channels.request}
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
								{friendlyEnvironmentsError(
									install.error,
									"Could not install the selected packages.",
								)}
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
							disabled={install.isPending || selected.length === 0 || previewLoading}
							data-qa-id="environments-conda-add-pkg-install-btn"
						>
							{install.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
							{install.isPending ? "Installing…" : installLabel}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AnacondaSignInDialog
				open={channels.signInOpen}
				onOpenChange={channels.setSignInOpen}
				onSignIn={() => void channels.completeSignIn()}
				pending={signIn.signingIn}
				error={signIn.error}
			/>
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
	error: { message: string; detail?: string } | null;
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
						message={error.message}
						{...(error.detail ? { detail: error.detail } : {})}
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
