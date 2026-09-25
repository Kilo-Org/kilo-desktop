import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { useAnacondaSignIn, useSdk, useSdkMutation, useSdkQuery } from "@kilo-desktop/sdk-react";
import { AnacondaSignInDialog } from "@kilo-desktop/ui/components/anaconda-sign-in-dialog";
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

import type { CondaRepodataFindResult, CondaService } from "../../../contracts/providers/conda.js";
import { ChannelChooserPopover } from "./ChannelChooserPopover.js";
import { useChannelSelection } from "./use-channel-selection.js";
import { validateEnvironmentName } from "./environment-display.js";
import {
	createEnvironmentJob,
	jobToastOptions,
	showJobError,
	showJobSuccess,
} from "./environments-toasts.js";
import {
	PackageResultsTable,
	PackageSearchInput,
	SelectedPackagesPane,
	selectedPackageToSpec,
	usePackageSelection,
} from "./PackageSearch.js";
import { PythonVersionPicker, PYTHON_LATEST } from "./PythonVersionPicker.js";
import { usePackageSearch } from "./use-package-search.js";

interface CreateEnvironmentDialogProps {
	open: boolean;
	onClose: () => void;
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

export function CreateEnvironmentDialog({ open, onClose }: CreateEnvironmentDialogProps) {
	const sdk = useSdk<CondaService>("environments");
	const signIn = useAnacondaSignIn(sdk);
	const [name, setName] = useState("");
	const [location, setLocation] = useState("");
	const [pythonVersion, setPythonVersion] = useState(PYTHON_LATEST);
	const [pythonVersions, setPythonVersions] = useState<string[]>(PYTHON_VERSIONS_FALLBACK);
	const [query, setQuery] = useState("");
	const [validationError, setValidationError] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const selection = usePackageSelection();
	// The in-flight create job, so "Run in background" can adopt it instead
	// of enqueueing a duplicate. `backgrounded` mutes the foreground handlers.
	const pendingCreateRef = useRef<{
		promise: Promise<unknown>;
		envName: string;
		backgrounded: boolean;
	} | null>(null);

	const prefixQuery = useSdkQuery(sdk, "conda.envs.prefixOptions");
	const mutation = useSdkMutation(sdk, "conda.envs.create", {
		invalidates: ["conda.envs.list"],
	});

	const envsDirs = useMemo(() => prefixQuery.data?.envsDirs ?? [], [prefixQuery.data?.envsDirs]);
	const defaultDir = envsDirs[0] ?? "";
	const channels = useChannelSelection(prefixQuery.data?.channels, signIn);
	const search = usePackageSearch({
		sdk,
		open,
		ready: !prefixQuery.isPending,
		query,
		channels: channels.channelsArg,
	});

	// Pre-fill the default directory once the query resolves.
	useEffect(() => {
		if (defaultDir && !location) setLocation(defaultDir);
	}, [defaultDir]); // eslint-disable-line react-hooks/exhaustive-deps

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
		sdk
			.invoke("conda.repodata.find", args)
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
	}, [open, channels.channelsArg, sdk]);

	function resetForm() {
		setName("");
		setLocation(defaultDir);
		setPythonVersion(PYTHON_LATEST);
		selection.reset();
		channels.reset();
		setQuery("");
		setValidationError(null);
		setSuccessMessage(null);
	}

	const packageSpecs = useMemo(() => {
		const specs = selection.selected.map(selectedPackageToSpec);
		if (pythonVersion !== PYTHON_LATEST) specs.push(`python=${pythonVersion}`);
		return specs;
	}, [selection.selected, pythonVersion]);

	function buildPayload() {
		const trimmedName = name.trim();
		const trimmedLocation = location.trim();
		// The env is created at `<location>/<name>` (what the preview shows), so
		// the prefix sent to conda must be that joined path, not the bare
		// directory the user picked.
		const prefix =
			trimmedLocation && trimmedLocation !== defaultDir
				? joinEnvPath(trimmedLocation, trimmedName)
				: undefined;
		return {
			name: trimmedName,
			...(packageSpecs.length > 0 ? { packages: packageSpecs } : {}),
			...(channels.selected.length > 0 ? { channels: channels.selected } : {}),
			...(prefix ? { prefix } : {}),
		};
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		const nameError = validateEnvironmentName(name);
		setValidationError(nameError);
		if (nameError) return;
		setSuccessMessage(null);
		const envName = name.trim();
		const job = createEnvironmentJob(envName);
		const promise = mutation.mutateAsync(buildPayload());
		const pending = { promise, envName, backgrounded: false };
		pendingCreateRef.current = pending;
		promise.then(
			() => {
				if (pending.backgrounded) return;
				showJobSuccess(job);
				setSuccessMessage(`${envName} was created.`);
			},
			(reason) => {
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
										aria-invalid={validationError ? true : undefined}
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

							{validationError ? <FieldError>{validationError}</FieldError> : null}

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
								qaPrefix="environments-create-package"
							/>
						</div>

						{selection.selected.length > 0 ? (
							<SelectedPackagesPane selection={selection} qaPrefix="environments-create" />
						) : null}
					</div>

					<DialogFooter className="sm:items-center">
						{successMessage ? (
							<p
								className="text-muted-foreground flex items-center gap-1.5 sm:mr-auto"
								role="status"
								data-qa-id="environments-create-success"
							>
								<CheckIcon className="text-success size-3.5 shrink-0" aria-hidden="true" />
								{successMessage}
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
						<Button
							type="submit"
							disabled={mutation.isPending || !name.trim()}
							data-qa-id="environments-create-submit"
						>
							{mutation.isPending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
							{mutation.isPending ? "Creating…" : "Create environment"}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>

			<AnacondaSignInDialog
				open={channels.signInOpen}
				onOpenChange={channels.setSignInOpen}
				onSignIn={() => void channels.completeSignIn()}
				pending={signIn.signingIn}
				error={signIn.error}
			/>
		</Dialog>
	);
}
