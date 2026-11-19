import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import {
	Combobox,
	ComboboxContent,
	ComboboxEmpty,
	ComboboxInput,
	ComboboxItem,
	ComboboxList,
} from "@kilo-desktop/ui/components/combobox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@kilo-desktop/ui/components/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";
import { CheckIcon, FolderIcon } from "lucide-react";

import { parseEnvironmentsErrorMessage } from "../../../contracts/common";
import { ENVIRONMENTS_TELEMETRY_EVENTS } from "../../../contracts/index";
import { condaQueryKey, useConda, useCondaMutation, useCondaQuery } from "../../conda";
import { useTrack } from "../../app";
import type { CondaEnv, CondaRepodataFindResult } from "../../../contracts/providers/conda";
import { ChannelChooserPopover } from "./ChannelChooserPopover";
import { useChannelSelection } from "./use-channel-selection";
import { validateEnvironmentName } from "./environment-display";
import {
	createEnvironmentJob,
	jobToastOptions,
	showJobError,
	showJobSuccess,
} from "./environments-toasts";
import {
	PackageResultsTable,
	PackageSearchInput,
	SelectedPackagesPane,
	selectedPackageToSpec,
	usePackageSelection,
	type PackageInstallPreset,
} from "./PackageSearch";
import { PythonVersionPicker, PYTHON_LATEST } from "./PythonVersionPicker";
import { useCreatePrefixCheck, type CreatePrefixCheckState } from "./use-create-prefix-check";
import { usePackageSearch } from "./use-package-search";

interface CreateEnvironmentDialogProps {
	open: boolean;
	onClose: () => void;
	/** Opens with these packages selected and channels added; read on mount. */
	preset?: PackageInstallPreset;
	/** The name the form opens with; read on mount. */
	initialName?: string;
	/** Called when an environment is created while the dialog is open. */
	onCreated?: (environment: CondaEnv) => void;
}

/**
 * Fallback Python versions shown only when the live repodata lookup for the
 * `python` package returns nothing (e.g. offline or provider not ready). The
 * real list is derived from repodata — see `pythonVersions`.
 */
const PYTHON_VERSIONS_FALLBACK = ["3.13.0", "3.12.0", "3.11.0", "3.10.0", "3.9.0"];

/**
 * Join a base directory and an environment name using the directory's own
 * separator. Shared by the path preview and the create payload so the env is
 * always created exactly where the preview promised.
 */
function joinEnvPath(baseDir: string, envName: string): string {
	const sep = baseDir.includes("\\") ? "\\" : "/";
	const base = baseDir.replace(/[/\\]+$/, "");
	return envName ? `${base}${sep}${envName}` : base;
}

/** Why the target can't be created, or `null` while it is (or may be) available. */
function prefixCheckError(
	check: CreatePrefixCheckState,
	target: { prefix: string; location: string; name: string },
): string | null {
	if (check.status === "error") {
		return "Couldn't check whether this location is available. Edit the name or location to try again.";
	}
	if (check.status !== "unavailable") return null;
	switch (check.reason) {
		case "exists-environment":
			return `An environment already exists at ${target.prefix}. Choose a different name or location.`;
		case "exists-file":
			return `A file already exists at ${target.prefix}. Choose a different name or location.`;
		case "reserved-name":
			return `"${target.name}" is reserved by conda. Choose a different name.`;
		case "invalid-path":
			return "The location must be an absolute path to a folder.";
		case "not-writable":
			return `You don't have permission to create environments in ${target.location}.`;
		case "inaccessible":
			return `Couldn't access ${target.prefix}. Check the location's permissions.`;
	}
}

export function CreateEnvironmentDialog({
	open,
	onClose,
	preset,
	initialName,
	onCreated,
}: CreateEnvironmentDialogProps) {
	const conda = useConda();
	const track = useTrack();
	const [name, setName] = useState(initialName ?? "");
	const [location, setLocation] = useState("");
	const [pythonVersion, setPythonVersion] = useState(PYTHON_LATEST);
	const [pythonVersions, setPythonVersions] = useState<string[]>(PYTHON_VERSIONS_FALLBACK);
	const [query, setQuery] = useState(() => preset?.packages[0]?.name ?? "");
	// The last environment created from this dialog. Its confirmation shows
	// only while the form still targets the same prefix.
	const [created, setCreated] = useState<{ prefix: string; envName: string } | null>(null);
	const selection = usePackageSelection(preset?.packages);
	const queryClient = useQueryClient();
	// The in-flight create job, so "Run in background" can adopt it instead
	// of enqueueing a duplicate. `backgrounded` mutes the foreground handlers.
	const pendingCreateRef = useRef<{
		promise: Promise<unknown>;
		envName: string;
		backgrounded: boolean;
	} | null>(null);

	const prefixQuery = useCondaQuery(conda, "prefixOptions");
	const mutation = useCondaMutation(conda, "createEnvironment", {
		invalidates: ["listEnvironments", "checkPrefix"],
	});

	const envsDirs = prefixQuery.data?.envsDirs ?? [];
	const defaultDir = envsDirs[0] ?? "";

	const trimmedName = name.trim();
	const trimmedLocation = location.trim();
	const nameError = trimmedName ? validateEnvironmentName(name) : null;
	// Always sent as an explicit prefix: a bare name would resolve against the
	// bridge's own envs_dirs, not the location shown (and checked) here.
	const targetPrefix =
		trimmedName && !nameError && trimmedLocation ? joinEnvPath(trimmedLocation, trimmedName) : null;
	const prefixCheck = useCreatePrefixCheck(conda, targetPrefix);
	const createdHere = created?.prefix === targetPrefix ? created : null;
	const justCreated = createdHere !== null;
	const prefixError =
		targetPrefix && !justCreated
			? prefixCheckError(prefixCheck, {
					prefix: targetPrefix,
					location: trimmedLocation,
					name: trimmedName,
				})
			: null;
	const canCreate = prefixCheck.status === "available" && !mutation.isPending;
	const channels = useChannelSelection(prefixQuery.data?.channels, preset?.channels);
	const search = usePackageSearch({
		conda,
		open,
		ready: !prefixQuery.isPending,
		query,
		channels: channels.channelsArg,
	});

	// Pre-fill the default directory once the query resolves.
	const [prefilledDir, setPrefilledDir] = useState("");
	if (prefilledDir !== defaultDir) {
		setPrefilledDir(defaultDir);
		if (defaultDir && !location) setLocation(defaultDir);
	}

	// Derive the Python version options from live repodata instead of a
	// hardcoded list: look up the `python` package by exact name and show its
	// full version list (newest first, patch-level included). Falls back to a
	// static list only when the lookup returns nothing (offline / provider
	// not ready).
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		const args = channels.channelsArg
			? { names: ["python"], limit: 1, channels: channels.channelsArg }
			: { names: ["python"], limit: 1 };
		conda
			.findRepodata(args)
			.then((result) => {
				if (cancelled) return;
				const { packages } = result as CondaRepodataFindResult;
				const python = packages.find((p) => p.name === "python");
				if (python && python.versions.length > 0) {
					setPythonVersions(python.versions.map((v) => v.version));
				}
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [open, channels.channelsArg, conda]);

	function resetForm() {
		setName("");
		setLocation(defaultDir);
		setPythonVersion(PYTHON_LATEST);
		selection.reset();
		channels.reset();
		setQuery("");
		setCreated(null);
	}

	const packageSpecs = [
		...selection.selected.map(selectedPackageToSpec),
		...(pythonVersion === PYTHON_LATEST ? [] : [`python=${pythonVersion}`]),
	];

	function buildPayload(prefix: string) {
		return {
			name: trimmedName,
			...(packageSpecs.length > 0 ? { packages: packageSpecs } : {}),
			...(channels.selected.length > 0 ? { channels: channels.selected } : {}),
			prefix,
		};
	}

	/** A create that hit an occupied prefix means our view is stale: refresh it. */
	function refreshAfterPrefixConflict(reason: unknown) {
		const message = reason instanceof Error ? reason.message : String(reason);
		if (parseEnvironmentsErrorMessage(message)?.code !== "ENV_EXISTS") return;
		for (const channel of ["checkPrefix", "listEnvironments"] as const) {
			void queryClient.invalidateQueries({ queryKey: condaQueryKey(channel) });
		}
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		// Gate the handler too, not only the button: the form can be submitted
		// programmatically or by assistive tech.
		if (!canCreate || !targetPrefix) return;
		setCreated(null);
		const envName = trimmedName;
		const job = createEnvironmentJob(envName);
		const payload = buildPayload(targetPrefix);
		const telemetryData = {
			packageCount: selection.selected.length,
			pythonPinned: pythonVersion !== PYTHON_LATEST,
			customLocation: trimmedLocation !== defaultDir,
		};
		const promise = mutation.mutateAsync(payload);
		const pending = { promise, envName, backgrounded: false };
		pendingCreateRef.current = pending;
		promise.then(
			({ environment }) => {
				// Tracked before the backgrounded check so jobs moved to a toast still count.
				track(ENVIRONMENTS_TELEMETRY_EVENTS.environmentCreated, telemetryData);
				if (pending.backgrounded) return;
				showJobSuccess(job);
				setCreated({ prefix: payload.prefix, envName });
				onCreated?.(environment);
			},
			(reason) => {
				refreshAfterPrefixConflict(reason);
				if (!pending.backgrounded) showJobError(job, reason);
			},
		);
	}

	function handleRunInBackground() {
		const pending = pendingCreateRef.current;
		if (!pending) return;
		pending.backgrounded = true;
		toast.promise(pending.promise, jobToastOptions(createEnvironmentJob(pending.envName)));
		resetForm();
		onClose();
	}

	function handleOpenChange(next: boolean) {
		if (!next) {
			resetForm();
			onClose();
		}
	}

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent
				data-qa-id="environments-create-dialog"
				className="h-[min(48rem,calc(100dvh-4rem))] grid-rows-[minmax(0,1fr)] gap-0 sm:max-w-6xl"
			>
				<form onSubmit={handleSubmit} className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
					<div
						className={cn(
							"-mx-4 -mt-4 grid min-h-0",
							selection.selected.length > 0
								? "grid-rows-[minmax(0,1fr)_minmax(0,14rem)] md:grid-cols-[minmax(0,1fr)_22rem] md:grid-rows-1"
								: "grid-cols-[minmax(0,1fr)]",
						)}
					>
						<div className="flex min-h-0 min-w-0 flex-col gap-4 p-4">
							<DialogHeader>
								<DialogTitle>Create environment</DialogTitle>
								<DialogDescription>
									Choose where the environment lives, its Python version, and any packages to start
									with.
								</DialogDescription>
							</DialogHeader>
							<FieldGroup className="gap-3 md:flex-row md:items-start">
								<Field className="md:flex-[2]">
									<FieldLabel htmlFor="environments-create-location">Location</FieldLabel>
									<Combobox
										items={envsDirs}
										value={location || null}
										onValueChange={(next) => {
											if (next) setLocation(next);
										}}
										inputValue={location}
										onInputValueChange={setLocation}
									>
										<ComboboxInput
											id="environments-create-location"
											className="w-full"
											placeholder={defaultDir || "/path/to/envs"}
											data-qa-id="environments-create-location"
										/>
										<ComboboxContent>
											<ComboboxEmpty>No matching locations.</ComboboxEmpty>
											<ComboboxList>
												{(dir: string) => (
													<ComboboxItem key={dir} value={dir}>
														<FolderIcon aria-hidden="true" />
														<span className="truncate">{dir}</span>
														{dir === defaultDir ? (
															<span className="text-muted-foreground ml-auto text-xs">default</span>
														) : null}
													</ComboboxItem>
												)}
											</ComboboxList>
										</ComboboxContent>
									</Combobox>
								</Field>
								<Field className="md:flex-1">
									<FieldLabel htmlFor="environments-create-name">Name</FieldLabel>
									<Input
										id="environments-create-name"
										value={name}
										onChange={(e) => setName(e.target.value)}
										placeholder="Enter environment name"
										aria-invalid={nameError || prefixError ? true : undefined}
										autoFocus
										data-qa-id="environments-create-name"
									/>
								</Field>
								<Field className="md:flex-1">
									<FieldLabel>Python version</FieldLabel>
									<PythonVersionPicker
										value={pythonVersion}
										versions={pythonVersions}
										onChange={setPythonVersion}
									/>
								</Field>
							</FieldGroup>

							{nameError ? (
								<FieldError data-qa-id="environments-create-name-error">{nameError}</FieldError>
							) : prefixError ? (
								<FieldError data-qa-id="environments-create-prefix-error">{prefixError}</FieldError>
							) : prefixCheck.status === "checking" && !justCreated && !mutation.isPending ? (
								<p
									className="text-muted-foreground flex items-center gap-1.5 text-sm"
									role="status"
									data-qa-id="environments-create-prefix-status"
								>
									<Spinner aria-hidden="true" />
									Checking availability…
								</p>
							) : null}

							<div className="flex shrink-0 items-center gap-2">
								<PackageSearchInput
									value={query}
									onChange={setQuery}
									qaId="environments-create-package-search"
								/>
								<ChannelChooserPopover
									open={channels.open}
									onOpenChange={channels.setOpen}
									summary={channels.summary}
									customized={channels.customized}
									qaId="environments-create-channels-button"
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
								qaPrefix="environments-create-package"
							/>
						</div>

						{selection.selected.length > 0 ? (
							<SelectedPackagesPane selection={selection} qaPrefix="environments-create" />
						) : null}
					</div>

					<DialogFooter className="sm:items-center">
						{createdHere ? (
							<p
								className="text-muted-foreground flex items-center gap-1.5 sm:mr-auto"
								role="status"
								data-qa-id="environments-create-success"
							>
								<CheckIcon className="text-success size-3.5 shrink-0" aria-hidden="true" />
								{createdHere.envName} was created.
							</p>
						) : null}
						{mutation.isPending ? (
							<Button
								type="button"
								variant="ghost"
								className="sm:mr-auto"
								onClick={handleRunInBackground}
								data-qa-id="environments-create-background"
							>
								Run in background
							</Button>
						) : null}
						<Button
							type="button"
							variant="outline"
							onClick={() => handleOpenChange(false)}
							disabled={mutation.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={!canCreate} data-qa-id="environments-create-submit">
							{mutation.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
							{mutation.isPending ? "Creating…" : "Create environment"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
