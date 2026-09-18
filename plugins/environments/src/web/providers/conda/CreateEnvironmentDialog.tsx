import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type FormEvent,
} from "react";

import { useSdk, useSdkMutation, useSdkQuery, useAnacondaSignIn } from "@kilo-desktop/sdk-react";
import { AnacondaSignInDialog } from "@kilo-desktop/ui/components/anaconda-sign-in-dialog";
import { Badge } from "@kilo-desktop/ui/components/badge";
import { Button } from "@kilo-desktop/ui/components/button";
import { Checkbox } from "@kilo-desktop/ui/components/checkbox";
import { Field, FieldError, FieldGroup, FieldLabel } from "@kilo-desktop/ui/components/field";
import { Input } from "@kilo-desktop/ui/components/input";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@kilo-desktop/ui/components/input-group";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@kilo-desktop/ui/components/empty";
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
import {
	CheckIcon,
	ChevronDownIcon,
	FolderIcon,
	NetworkIcon,
	PackageIcon,
	SearchIcon,
	XIcon,
} from "lucide-react";

import type {
	CondaRepodataFindResult,
	CondaRepodataPackage,
	CondaService,
} from "../../../contracts/providers/conda.js";
import { validateEnvironmentName } from "./environment-display.js";
import {
	showEnvironmentCreatedToast,
	showEnvironmentsErrorToast,
	trackBackgroundCreateToast,
} from "./environments-toasts.js";
import { PythonVersionPicker, PYTHON_LATEST } from "./PythonVersionPicker.js";
import { ChannelChooserPopover } from "./ChannelChooserPopover.js";
import {
	defaultChannelSelection,
	getChannelPresentation,
	selectableChannels,
} from "./channel-presentation.js";
import { ColumnResizer } from "./ColumnResizer.js";
import { TablePagination } from "./TablePagination.js";
import {
	MIN_PACKAGE_GRID_COLUMN_WIDTH,
	readPackageGridColumnWidths,
	resizeColumn,
	writePackageGridColumnWidths,
	type PackageGridColumnId,
} from "./column-widths.js";

interface CreateEnvironmentDialogProps {
	open: boolean;
	onClose: () => void;
}

/** A chosen package with an optional pinned version (null = latest). */
interface SelectedPackage {
	name: string;
	version: string | null;
}

/** Sentinel Select value for the "latest" (unpinned) package version. */
const LATEST = "__latest__";
/**
 * Fallback Python versions shown only when the live repodata lookup for the
 * `python` package returns nothing (e.g. offline or provider not ready). The
 * real list is derived from repodata — see `pythonVersions`.
 */
const PYTHON_VERSIONS_FALLBACK = ["3.13.0", "3.12.0", "3.11.0", "3.10.0", "3.9.0"];

const PAGE_SIZE = 20;
const SEARCH_LIMIT = 200;

/** Convert a selection to a conda match spec: `name=version` or bare `name`. */
function selectedPackageToSpec(pkg: SelectedPackage): string {
	return pkg.version ? `${pkg.name}=${pkg.version}` : pkg.name;
}

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

function versionValueToPinned(value: string): string | null {
	return value && value !== LATEST ? value : null;
}

/** Format a byte count as a human-readable size (e.g. 1536 → "1.5 KB"). */
function formatSize(bytes: number): string {
	if (bytes <= 0) return "—";
	const units = ["B", "KB", "MB", "GB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit++;
	}
	return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
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
	rowVersions: Record<string, string>;
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
	rowVersions,
	onToggle,
	onVersionChange,
	onPageChange,
}: PackageGridProps) {
	const pageItems = packages.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
	const [columnWidths, setColumnWidths] = useState(() => readPackageGridColumnWidths());
	// Mirrored in a ref so a drag resolves against the width it started from
	// without the pointer handlers closing over a stale render.
	const columnWidthsRef = useRef(columnWidths);
	columnWidthsRef.current = columnWidths;
	const handleColumnResize = useCallback(
		(column: PackageGridColumnId, nextWidthPx: number, options: { persist: boolean }) => {
			const current = columnWidthsRef.current;
			const next = resizeColumn(
				current,
				column,
				nextWidthPx - current[column],
				MIN_PACKAGE_GRID_COLUMN_WIDTH,
			);
			columnWidthsRef.current = next;
			setColumnWidths(next);
			if (options.persist) writePackageGridColumnWidths(next);
		},
		[],
	);

	return (
		// Custom properties keep the header and every row on one set of widths
		// without threading them through each cell.
		<div
			className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border"
			style={
				{
					"--package-size-column": `${columnWidths.size}px`,
					"--package-version-column": `${columnWidths.version}px`,
				} as CSSProperties
			}
		>
			<div
				className="text-muted-foreground bg-muted/50 group/columns flex items-center gap-1.5 border-b px-2 py-2 text-xs font-medium"
				data-qa-id="environments-create-package-header"
			>
				<span className="w-4" />
				<span className="flex-1">Package</span>
				<span className="relative ml-3" style={{ width: "var(--package-size-column)" }}>
					Size
					<ColumnResizer
						label="Size"
						width={columnWidths.size}
						minWidth={MIN_PACKAGE_GRID_COLUMN_WIDTH}
						qaId="environments-create-column-resizer-size"
						edge="leading"
						className="-inset-y-2 -left-4"
						onResize={(next, options) => handleColumnResize("size", next, options)}
					/>
				</span>
				<span className="relative ml-3" style={{ width: "var(--package-version-column)" }}>
					Version
					<ColumnResizer
						label="Version"
						width={columnWidths.version}
						minWidth={MIN_PACKAGE_GRID_COLUMN_WIDTH}
						qaId="environments-create-column-resizer-version"
						edge="leading"
						className="-inset-y-2 -left-4"
						onResize={(next, options) => handleColumnResize("version", next, options)}
					/>
				</span>
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
						const rowVersion = rowVersions[pkg.name] ?? LATEST;
						const sizeForRow =
							rowVersion === LATEST
								? (pkg.versions.find((v) => v.version === pkg.version) ?? pkg.versions[0])?.size
								: pkg.versions.find((v) => v.version === rowVersion)?.size;
						return (
							<div
								key={pkg.name}
								role="button"
								tabIndex={0}
								aria-pressed={isSelected}
								onClick={() => onToggle(pkg, !isSelected)}
								onKeyDown={(e) => {
									if (e.key === " " || e.key === "Enter") {
										e.preventDefault();
										onToggle(pkg, !isSelected);
									}
								}}
								className="hover:bg-accent focus-visible:ring-ring/50 flex cursor-pointer items-center gap-1.5 border-b px-2 py-2 text-sm transition-colors outline-none last:border-b-0 focus-visible:ring-2"
								data-qa-id="environments-create-package-row"
							>
								<Checkbox
									checked={isSelected}
									tabIndex={-1}
									aria-hidden
									className="pointer-events-none w-4"
									data-qa-id={`environments-create-package-checkbox-${pkg.name}`}
								/>
								<span className="min-w-0 flex-1 truncate font-medium">{pkg.name}</span>
								<span
									className="text-muted-foreground ml-3 truncate text-xs tabular-nums"
									style={{ width: "var(--package-size-column)" }}
									data-qa-id={`environments-create-package-size-${pkg.name}`}
								>
									{sizeForRow ? formatSize(sizeForRow) : "—"}
								</span>
								{pkg.versions.length > 0 ? (
									<div
										className="ml-3"
										style={{ width: "var(--package-version-column)" }}
										onClick={(e) => e.stopPropagation()}
										onKeyDown={(e) => e.stopPropagation()}
									>
										<Select
											value={rowVersion}
											onValueChange={(v) => onVersionChange(pkg, v ?? LATEST)}
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
									<span
										className="text-muted-foreground ml-3 truncate text-xs"
										style={{ width: "var(--package-version-column)" }}
									>
										{pkg.version ?? "latest"}
									</span>
								)}
							</div>
						);
					})}
			</div>
			{!loading && truncated && (
				<p
					className="text-muted-foreground border-t px-2 py-2 text-xs"
					data-qa-id="environments-create-truncated-hint"
				>
					Showing the first {packages.length} packages — refine your search to find others.
				</p>
			)}
			{!loading && packages.length > PAGE_SIZE && (
				<TablePagination
					pageIndex={page}
					pageCount={pageCount}
					onPageChange={onPageChange}
					rangeStart={page * PAGE_SIZE + 1}
					rangeEnd={Math.min((page + 1) * PAGE_SIZE, packages.length)}
					totalItems={packages.length}
					qaPrefix="environments-create-package"
					className="border-t px-3 py-2"
				/>
			)}
		</div>
	);
}

/* --------------------------------------------------------------------- */
/* SelectedPackagesSidebar                                               */
/* --------------------------------------------------------------------- */

interface SelectedPackagesSidebarProps {
	selected: SelectedPackage[];
	onRemove: (name: string) => void;
}

function SelectedPackagesSidebar({ selected, onRemove }: SelectedPackagesSidebarProps) {
	return (
		<aside className="flex min-h-0 flex-col border-l">
			<div className="flex items-center justify-between border-b px-4 py-4">
				<h3 className="font-semibold">Selected Packages</h3>
				<Badge variant="secondary" data-qa-id="environments-create-selected-count">
					{selected.length}
				</Badge>
			</div>
			<div
				className="min-h-0 flex-1 overflow-y-auto"
				data-qa-id="environments-create-selected-list"
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
							data-qa-id="environments-create-selected-item"
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

/* --------------------------------------------------------------------- */
/* CreateEnvironmentDialog                                               */
/* --------------------------------------------------------------------- */

export function CreateEnvironmentDialog({ open, onClose }: CreateEnvironmentDialogProps) {
	const sdk = useSdk<CondaService>("environments");
	const { authenticated, signingIn, error: signInError, signIn } = useAnacondaSignIn(sdk);
	const [name, setName] = useState("");
	const [location, setLocation] = useState("");
	const [pythonVersion, setPythonVersion] = useState(PYTHON_LATEST);
	const [pythonVersions, setPythonVersions] = useState<string[]>(PYTHON_VERSIONS_FALLBACK);
	const [selected, setSelected] = useState<SelectedPackage[]>([]);
	const [rowVersions, setRowVersions] = useState<Record<string, string>>({});
	const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
	const [showChannels, setShowChannels] = useState(false);
	// The Anaconda channel whose selection was deferred to sign-in; applied
	// once the OAuth round-trip lands the session.
	const [pendingChannel, setPendingChannel] = useState<string>();
	const [signInOpen, setSignInOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [results, setResults] = useState<CondaRepodataPackage[]>([]);
	const [resultsTruncated, setResultsTruncated] = useState(false);
	const [loadingPackages, setLoadingPackages] = useState(false);
	const [page, setPage] = useState(0);
	const [validationError, setValidationError] = useState<string | null>(null);
	const [showLocationSuggestions, setShowLocationSuggestions] = useState(false);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
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

	const envsDirs = prefixQuery.data?.envsDirs ?? [];
	const defaultDir = envsDirs[0] ?? "";
	const availableChannels = useMemo(
		() => selectableChannels(prefixQuery.data?.channels ?? []),
		[prefixQuery.data?.channels],
	);

	// Pre-fill the default directory once the query resolves.
	useEffect(() => {
		if (defaultDir && !location) setLocation(defaultDir);
	}, [defaultDir]); // eslint-disable-line react-hooks/exhaustive-deps

	// Auto-select the default channels when data first loads, skipping
	// sign-in-gated Anaconda channels for signed-out users.
	useEffect(() => {
		if (availableChannels.length > 0 && selectedChannels.length === 0) {
			setSelectedChannels(defaultChannelSelection(availableChannels, authenticated));
		}
	}, [availableChannels, authenticated]); // eslint-disable-line react-hooks/exhaustive-deps

	const channelsArg = useMemo(
		() => (selectedChannels.length > 0 ? selectedChannels : undefined),
		[selectedChannels],
	);

	function toggleChannel(channel: string) {
		setSelectedChannels((prev) =>
			prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel],
		);
	}

	// Anaconda channels stay gated while signed out: remember which one the
	// user picked, run the OAuth flow, and apply the selection on success.
	async function handleSignIn(): Promise<void> {
		const ok = await signIn();
		if (!ok) return;
		setSignInOpen(false);
		const channel = pendingChannel;
		setPendingChannel(undefined);
		if (channel && availableChannels.includes(channel)) {
			setSelectedChannels((prev) => (prev.includes(channel) ? prev : [...prev, channel]));
		}
	}

	function handleChannelSelect(channel: string) {
		if (getChannelPresentation(channel).requiresSignIn && !authenticated) {
			setPendingChannel(channel);
			setSignInOpen(true);
			return;
		}
		toggleChannel(channel);
	}

	// Derive the Python version options from live repodata instead of a
	// hardcoded list: look up the `python` package by exact name and show its
	// full version list (newest first, patch-level included). Falls back to a
	// static list only when the lookup returns nothing (offline / provider
	// not ready).
	useEffect(() => {
		if (!open) return;
		let cancelled = false;
		const args = channelsArg
			? { names: ["python"], limit: 1, channels: channelsArg }
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
	}, [open, channelsArg, sdk]);

	// Debounced package lookup. A typed query becomes a partial-match
	// `query` search (ranked exact > prefix > substring in the main process
	// against the cached index); an empty query browses the bounded full
	// index (paged below).
	useEffect(() => {
		if (!open) return;
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
	}, [open, query, channelsArg, sdk]);

	const selectedByName = useMemo(() => new Map(selected.map((s) => [s.name, s])), [selected]);
	const pageCount = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
	const effectiveLocation = location || defaultDir;

	const pathPreview = useMemo(() => {
		if (!effectiveLocation) return "";
		return joinEnvPath(effectiveLocation, name.trim());
	}, [effectiveLocation, name]);

	function resetForm() {
		setName("");
		setLocation(defaultDir);
		setPythonVersion(PYTHON_LATEST);
		setSelected([]);
		setRowVersions({});
		setSelectedChannels(defaultChannelSelection(availableChannels, authenticated));
		setShowChannels(false);
		setPendingChannel(undefined);
		setSignInOpen(false);
		setQuery("");
		setResults([]);
		setResultsTruncated(false);
		setPage(0);
		setValidationError(null);
		setShowLocationSuggestions(false);
		setSuccessMessage(null);
	}

	function togglePackage(pkg: CondaRepodataPackage, checked: boolean) {
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
		setRowVersions((prev) => ({ ...prev, [pkg.name]: value }));
		if (selectedByName.has(pkg.name)) {
			const pinned = versionValueToPinned(value);
			setSelected((prev) => prev.map((p) => (p.name === pkg.name ? { ...p, version: pinned } : p)));
		}
	}

	const packageSpecs = useMemo(() => {
		const specs = selected.map(selectedPackageToSpec);
		if (pythonVersion !== PYTHON_LATEST) specs.push(`python=${pythonVersion}`);
		return specs;
	}, [selected, pythonVersion]);

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
			...(selectedChannels.length > 0 ? { channels: selectedChannels } : {}),
			...(prefix ? { prefix } : {}),
		};
	}

	function validate(): boolean {
		const nameError = validateEnvironmentName(name);
		if (nameError) {
			setValidationError(nameError);
			return false;
		}
		setValidationError(null);
		return true;
	}

	function handleSubmit(e: FormEvent) {
		e.preventDefault();
		if (!validate()) return;
		setSuccessMessage(null);
		const envName = name.trim();
		const promise = mutation.mutateAsync(buildPayload());
		const pending = { promise, envName, backgrounded: false };
		pendingCreateRef.current = pending;
		promise.then(
			() => {
				if (pending.backgrounded) return;
				showEnvironmentCreatedToast(envName);
				setSuccessMessage(`${envName} was created successfully.`);
			},
			(reason) => {
				if (pending.backgrounded) return;
				showEnvironmentsErrorToast(
					envName ? `Failed to create ${envName}` : "Failed to create environment",
					reason,
					"Could not create environment.",
				);
			},
		);
	}

	function handleRunInBackground() {
		const pending = pendingCreateRef.current;
		if (!pending) return;
		pending.backgrounded = true;
		trackBackgroundCreateToast(
			pending.promise,
			pending.envName || "environment",
			"Could not create environment.",
		);
		resetForm();
		onClose();
	}

	function handleOpenChange(next: boolean) {
		if (!next) {
			resetForm();
			onClose();
		}
	}

	const allChannelsSelected =
		availableChannels.length > 0 && availableChannels.every((c) => selectedChannels.includes(c));
	const channelsSummary = allChannelsSelected
		? "All channels"
		: selectedChannels.length === 0
			? "No channels"
			: `${selectedChannels.length} channel${selectedChannels.length === 1 ? "" : "s"}`;

	const canSubmit = !mutation.isPending && !!name.trim();

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			{/*
			 * Two grid rows — header, then the form — so the package grid and the
			 * selected-packages sidebar scroll inside a fixed-height modal instead
			 * of growing it past the viewport.
			 */}
			<DialogContent
				data-qa-id="environments-create-dialog"
				className="h-[85vh] max-h-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0 sm:max-w-5xl"
			>
				<DialogHeader className="shrink-0 border-b px-6 py-4">
					<DialogTitle>Create Environment</DialogTitle>
				</DialogHeader>

				<form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
					<div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[1fr_20rem]">
						{/* Main content */}
						<div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 py-5">
							{/* Location / Name / Python Version */}
							<FieldGroup className="flex-col items-start gap-3 md:flex-row">
								<Field className="relative flex-[2]">
									<FieldLabel>Location</FieldLabel>
									<div className="relative">
										<Input
											value={location}
											onChange={(e) => {
												setLocation(e.target.value);
												setShowLocationSuggestions(true);
											}}
											onFocus={() => setShowLocationSuggestions(true)}
											onBlur={() => setTimeout(() => setShowLocationSuggestions(false), 150)}
											placeholder={defaultDir || "/path/to/envs"}
											className="pr-8 font-mono text-xs"
											data-qa-id="environments-create-location"
										/>
										<button
											type="button"
											tabIndex={-1}
											className="absolute top-0 right-0 flex h-full w-8 items-center justify-center"
											onMouseDown={(e) => {
												e.preventDefault();
												setShowLocationSuggestions((v) => !v);
											}}
											aria-label="Toggle location suggestions"
										>
											<ChevronDownIcon className="text-muted-foreground size-4" />
										</button>
										{showLocationSuggestions && envsDirs.length > 0 && (
											<div className="bg-popover ring-foreground/10 absolute top-full right-0 left-0 z-20 mt-1 overflow-hidden rounded-lg ring-1">
												{envsDirs.map((dir, i) => (
													<button
														key={dir}
														type="button"
														className="hover:bg-accent flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-colors"
														onMouseDown={(e) => {
															e.preventDefault();
															setLocation(dir);
															setShowLocationSuggestions(false);
														}}
													>
														<FolderIcon className="text-muted-foreground size-3.5 shrink-0" />
														<span className="truncate font-mono">{dir}</span>
														{i === 0 && (
															<span className="text-muted-foreground ml-auto shrink-0 text-[10px]">
																default
															</span>
														)}
													</button>
												))}
											</div>
										)}
									</div>
								</Field>
								<Field className="flex-1">
									<FieldLabel>Name</FieldLabel>
									<Input
										value={name}
										onChange={(e) => setName(e.target.value)}
										placeholder="Enter environment name"
										autoFocus
										data-qa-id="environments-create-name"
									/>
								</Field>
								<Field className="flex-1">
									<FieldLabel>Python Version</FieldLabel>
									<PythonVersionPicker
										value={pythonVersion}
										versions={pythonVersions}
										onChange={setPythonVersion}
									/>
								</Field>
							</FieldGroup>

							{validationError ? <FieldError>{validationError}</FieldError> : null}

							{pathPreview && (
								<div
									className="bg-muted/50 flex items-center gap-2 rounded-lg px-3 py-2"
									data-qa-id="environments-create-path-preview"
								>
									<FolderIcon className="text-muted-foreground size-4 shrink-0" />
									<span className="text-muted-foreground truncate font-mono text-xs">
										{pathPreview}
									</span>
								</div>
							)}

							{/* Select packages header + Channels */}
							<div className="flex items-center justify-between">
								<h4 className="text-base font-semibold">Select packages</h4>
								<ChannelChooserPopover
									open={showChannels}
									onOpenChange={setShowChannels}
									availableChannels={availableChannels}
									selectedChannels={selectedChannels}
									onToggle={toggleChannel}
									signedIn={authenticated}
									onRequestSignIn={handleChannelSelect}
									trigger={{
										"data-qa-id": "environments-create-channels-button",
										children: (
											<>
												<NetworkIcon data-icon="inline-start" />
												Channels
												<Badge variant="secondary" className="ml-1">
													{channelsSummary}
												</Badge>
											</>
										),
									}}
								/>
							</div>

							{/* Search */}
							<InputGroup>
								<InputGroupAddon>
									<SearchIcon />
								</InputGroupAddon>
								<InputGroupInput
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder="Search"
									data-qa-id="environments-create-package-search"
								/>
							</InputGroup>

							{/* Package grid */}
							<PackageGrid
								loading={loadingPackages}
								packages={results}
								truncated={resultsTruncated}
								query={query}
								page={page}
								pageCount={pageCount}
								selectedByName={selectedByName}
								rowVersions={rowVersions}
								onToggle={togglePackage}
								onVersionChange={changeRowVersion}
								onPageChange={setPage}
							/>
						</div>

						<SelectedPackagesSidebar selected={selected} onRemove={removePackage} />
					</div>

					{mutation.isPending && (
						<div className="bg-muted/50 mx-6 mb-2 flex items-center justify-between rounded-lg px-3 py-2 text-sm">
							<div className="flex items-center gap-2">
								<Spinner size="sm" />
								<span className="text-muted-foreground">
									Resolving dependencies — this may take a few minutes…
								</span>
							</div>
							<Button
								type="button"
								variant="outline"
								size="sm"
								onClick={handleRunInBackground}
								data-qa-id="environments-create-background"
							>
								Run in background
							</Button>
						</div>
					)}

					{/* Footer */}
					<div className="bg-muted/40 flex items-center justify-end gap-2 border-t px-6 py-4">
						{successMessage && (
							<span
								className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400"
								data-qa-id="environments-create-success"
							>
								<CheckIcon className="size-4 shrink-0" />
								{successMessage}
							</span>
						)}
						<Button
							type="button"
							variant="outline"
							onClick={() => handleOpenChange(false)}
							disabled={mutation.isPending}
						>
							Cancel
						</Button>
						<Button type="submit" disabled={!canSubmit} data-qa-id="environments-create-submit">
							{mutation.isPending ? "Creating…" : "Create Environment"}
						</Button>
					</div>
				</form>
			</DialogContent>

			<AnacondaSignInDialog
				open={signInOpen}
				onOpenChange={setSignInOpen}
				onSignIn={() => void handleSignIn()}
				pending={signingIn}
				error={signInError}
			/>
		</Dialog>
	);
}
