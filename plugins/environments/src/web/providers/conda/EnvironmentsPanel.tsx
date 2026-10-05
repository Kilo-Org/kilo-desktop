import { useCallback, useMemo, useState, useSyncExternalStore } from "react";

import { useQuery } from "@tanstack/react-query";

import { SettingsPageHeader, sdkQueryOptions, useSdk } from "@kilo-desktop/sdk-react";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
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
import { SummaryCard } from "@kilo-desktop/ui/components/summary-card";
import {
	BoxIcon,
	BoxesIcon,
	ChevronDownIcon,
	CopyIcon,
	EllipsisIcon,
	FileUpIcon,
	PlusIcon,
	SearchIcon,
	SearchXIcon,
	Trash2Icon,
} from "lucide-react";

import type { CondaEnv, CondaService } from "../../../contracts/providers/conda.js";
import { EnvironmentsListSkeleton } from "../../EnvironmentsListSkeleton.js";
import { CloneEnvironmentDialog } from "./CloneEnvironmentDialog.js";
import { CreateEnvironmentDialog } from "./CreateEnvironmentDialog.js";
import { DeleteEnvironmentDialog } from "./DeleteEnvironmentDialog.js";
import { EnvironmentDetail, EnvironmentDetailLoading } from "./EnvironmentDetail.js";
import { EnvironmentsErrorState, EnvironmentsStartingState } from "./EnvironmentsPanelStates.js";
import { ImportEnvironmentDialog } from "./ImportEnvironmentDialog.js";
import { environmentDisplayName } from "./environment-display.js";
import { isProviderNotReadyError } from "./environments-error-message.js";
import { ListViewMenu, type SortDirection } from "./ListViewMenu.js";
import { useProviderNotReadySince } from "./useProviderNotReadySince.js";

/**
 * How often to re-read `conda.envs.list` while the backend reports
 * `PROVIDER_NOT_READY`. The sidecar restarts itself on a cold start or after
 * an update; a short fixed poll clears the "starting" state the moment it
 * comes up. The per-fetch `retry` is disabled so this interval is the sole
 * re-attempt mechanism (layering TanStack's exponential backoff on top of the
 * poll stretches real recovery-detection latency to tens of seconds).
 */
const PROVIDER_NOT_READY_POLL_MS = 3_000;

type EnvironmentSortField = "name" | "location";

const SORT_FIELDS = [
	{ value: "name", label: "Name" },
	{ value: "location", label: "Location" },
] as const;

/**
 * Read the `env` search param from the shell location. When a user selects
 * an environment, we navigate to `?env=<prefix>` via `sdk.navigate`; going
 * back clears the param. This keeps TanStack Router's history tracking
 * intact — no raw `window.history.pushState` that clobbers `__TSR_index`.
 */
function useSelectedPrefix(sdk: ReturnType<typeof useSdk<CondaService>>): string | undefined {
	const subscribe = useCallback((fn: () => void) => sdk.location.subscribe(fn), [sdk]);
	const getSnapshot = useCallback(() => {
		const env = sdk.location.peek().search.env;
		return typeof env === "string" && env ? env : undefined;
	}, [sdk]);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function useGoBack(sdk: ReturnType<typeof useSdk<CondaService>>): () => void {
	return useCallback(() => {
		const currentPath = sdk.location.peek().path;
		sdk.navigate(currentPath, { search: {} });
	}, [sdk]);
}

/**
 * Loading state for callers that mount before the panel (the page's provider
 * status wait): shaped like the view the URL selects, so a deep link to
 * `?env=` shows the detail shape throughout instead of flashing the list.
 */
export function EnvironmentsPanelLoading() {
	const sdk = useSdk<CondaService>("environments");
	const selectedPrefix = useSelectedPrefix(sdk);
	const goBack = useGoBack(sdk);
	return selectedPrefix ? (
		<EnvironmentDetailLoading prefix={selectedPrefix} onBack={goBack} />
	) : (
		<>
			<SettingsPageHeader />
			<EnvironmentsListSkeleton />
		</>
	);
}

type DialogState =
	| { kind: "none" }
	| { kind: "create" }
	| { kind: "import" }
	| { kind: "clone"; env: CondaEnv }
	| { kind: "delete"; env: CondaEnv };

/**
 * Renderer panel for the conda provider.
 *
 * Reads `conda.envs.list` via `useSdkQuery`, which pipes through the plugin's
 * `mainRegister` handler and, in production, calls `conda env list --json`
 * inside the plugin-scoped base. The list follows the app's settings pattern
 * for configured entities: header actions, a search + sort toolbar, and one
 * bordered panel of joined rows. Everything is client-side — the full dataset
 * arrives in a single RPC call.
 *
 * Selecting a row opens the detail view (`?env=<prefix>`), which replaces the
 * list and its header actions until the user goes back. While the list is
 * still loading, a selected prefix shows the detail loading state instead of
 * the list skeleton.
 */
export function EnvironmentsPanel() {
	const sdk = useSdk<CondaService>("environments");
	const envs = useQuery({
		...sdkQueryOptions(sdk, "conda.envs.list"),
		// Fixed-interval polling (below) is the sole re-attempt mechanism for a
		// warming-up backend; see PROVIDER_NOT_READY_POLL_MS.
		retry: false,
		refetchInterval: (query) =>
			isProviderNotReadyError(query.state.error) ? PROVIDER_NOT_READY_POLL_MS : false,
	});
	// Derive from *settled* query states only. TanStack flips a still-empty
	// query back to pending/`error: null` during each background refetch, so
	// `envs.error` is transiently null between polls; latching on that would
	// flicker the UI and reset the startup window every ~3s.
	const settledNotReady = envs.isError && isProviderNotReadyError(envs.error);
	const notReadySince = useProviderNotReadySince({
		notReady: settledNotReady,
		resolved: envs.isSuccess || (envs.isError && !settledNotReady),
	});
	const selectedPrefix = useSelectedPrefix(sdk);
	const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
	const closeDialog = useCallback(() => setDialog({ kind: "none" }), []);

	const selectEnv = useCallback(
		(env: CondaEnv) => {
			const currentPath = sdk.location.peek().path;
			sdk.navigate(currentPath, { search: { env: env.prefix } });
		},
		[sdk],
	);

	const goBack = useGoBack(sdk);

	const selectedEnv = useMemo(() => {
		if (!selectedPrefix || !envs.data) return null;
		return envs.data.find((e) => e.prefix === selectedPrefix) ?? null;
	}, [selectedPrefix, envs.data]);

	if (selectedEnv) {
		return <EnvironmentDetail env={selectedEnv} onBack={goBack} />;
	}

	if (selectedPrefix && envs.isPending) {
		return <EnvironmentDetailLoading prefix={selectedPrefix} onBack={goBack} />;
	}

	return (
		<div className="flex min-w-0 flex-col gap-6" data-qa-id="environments-controls">
			<SettingsPageHeader
				actions={
					<DropdownMenu>
						<DropdownMenuTrigger
							render={<Button type="button" size="sm" data-qa-id="environments-new-menu" />}
						>
							<PlusIcon data-icon="inline-start" aria-hidden="true" />
							New environment
							<ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="min-w-44">
							<DropdownMenuGroup>
								<DropdownMenuItem
									onClick={() => setDialog({ kind: "create" })}
									data-qa-id="environments-create-item"
								>
									<BoxIcon aria-hidden="true" />
									Create new
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={() => setDialog({ kind: "import" })}
									data-qa-id="environments-import-item"
								>
									<FileUpIcon aria-hidden="true" />
									Import file
								</DropdownMenuItem>
							</DropdownMenuGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				}
			/>

			<div className="flex min-w-0 flex-col gap-4">
				{envs.isSuccess ? (
					(envs.data ?? []).length === 0 ? (
						<Empty className="border" data-qa-id="environments-conda-empty">
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<BoxesIcon aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>No conda environments found</EmptyTitle>
								<EmptyDescription>
									Create an environment or import one from an environment file.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<EnvironmentsList
							rows={envs.data ?? []}
							onSelectEnv={selectEnv}
							onClone={(env) => setDialog({ kind: "clone", env })}
							onDelete={(env) => setDialog({ kind: "delete", env })}
						/>
					)
				) : notReadySince !== null ? (
					<EnvironmentsStartingState
						startedAt={notReadySince}
						onRetry={() => void envs.refetch()}
					/>
				) : envs.isPending ? (
					<EnvironmentsListSkeleton />
				) : (
					<EnvironmentsErrorState error={envs.error} onRetry={() => void envs.refetch()} />
				)}
			</div>

			<CreateEnvironmentDialog open={dialog.kind === "create"} onClose={closeDialog} />
			<ImportEnvironmentDialog open={dialog.kind === "import"} onClose={closeDialog} />
			{dialog.kind === "clone" && (
				<CloneEnvironmentDialog env={dialog.env} open onClose={closeDialog} />
			)}
			{dialog.kind === "delete" && (
				<DeleteEnvironmentDialog env={dialog.env} open onClose={closeDialog} />
			)}
		</div>
	);
}

/** Nameless envs: base installs and prefix-only envs both have `name: ""`. */
function isNamelessEnv(env: CondaEnv): boolean {
	return env.name === "";
}

function sortKey(env: CondaEnv, field: EnvironmentSortField): string {
	return field === "name" ? environmentDisplayName(env) : env.prefix;
}

interface EnvironmentsListProps {
	rows: CondaEnv[];
	onSelectEnv: (env: CondaEnv) => void;
	onClone: (env: CondaEnv) => void;
	onDelete: (env: CondaEnv) => void;
}

function EnvironmentsList({ rows, onSelectEnv, onClone, onDelete }: EnvironmentsListProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [sortField, setSortField] = useState<EnvironmentSortField>("name");
	const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

	const visible = useMemo(() => {
		const query = searchQuery.trim().toLowerCase();
		const matches = query
			? rows.filter(
					(env) =>
						environmentDisplayName(env).toLowerCase().includes(query) ||
						env.prefix.toLowerCase().includes(query),
				)
			: rows;
		return matches.toSorted((a, b) => {
			const comparison = sortKey(a, sortField).localeCompare(sortKey(b, sortField));
			return sortDirection === "asc" ? comparison : -comparison;
		});
	}, [rows, searchQuery, sortField, sortDirection]);

	return (
		<>
			<div className="flex shrink-0 items-center gap-2">
				<InputGroup size="sm" className="min-w-40 flex-1">
					<InputGroupInput
						type="search"
						value={searchQuery}
						onChange={(event) => setSearchQuery(event.currentTarget.value)}
						placeholder="Search environments"
						aria-label="Search environments"
						data-qa-id="environments-search-input"
					/>
					<InputGroupAddon>
						<SearchIcon aria-hidden="true" />
					</InputGroupAddon>
				</InputGroup>
				<ListViewMenu
					label="Sort environments"
					fields={SORT_FIELDS}
					field={sortField}
					direction={sortDirection}
					onFieldChange={setSortField}
					onDirectionChange={setSortDirection}
					qaId="environments-sort-menu"
				/>
			</div>

			{visible.length === 0 ? (
				<Empty className="border" data-qa-id="environments-conda-empty-filtered">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<SearchXIcon aria-hidden="true" />
						</EmptyMedia>
						<EmptyTitle>No environments match</EmptyTitle>
						<EmptyDescription>Try a different name or location.</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button type="button" variant="outline" size="sm" onClick={() => setSearchQuery("")}>
							Clear search
						</Button>
					</EmptyContent>
				</Empty>
			) : (
				<ul
					className="border-border bg-card divide-border min-w-0 divide-y overflow-hidden rounded-lg border"
					aria-label="Conda environments"
					data-qa-id="environments-conda-list"
				>
					{visible.map((env) => (
						<EnvironmentRow
							key={env.prefix}
							env={env}
							onSelect={() => onSelectEnv(env)}
							onClone={() => onClone(env)}
							onDelete={() => onDelete(env)}
						/>
					))}
				</ul>
			)}
		</>
	);
}

function EnvironmentRow({
	env,
	onSelect,
	onClone,
	onDelete,
}: {
	env: CondaEnv;
	onSelect: () => void;
	onClone: () => void;
	onDelete: () => void;
}) {
	const displayName = environmentDisplayName(env);

	return (
		<li className="hover:bg-muted transition-colors" data-qa-id="environments-conda-row">
			<SummaryCard.Row>
				<SummaryCard.Button
					className="focus-visible:ring-ring/50 rounded-md outline-none focus-visible:ring-[3px]"
					aria-label={`Open ${displayName}`}
					onClick={onSelect}
					data-qa-id="environments-conda-row-open"
				>
					<SummaryCard.Content>
						<SummaryCard.Title data-qa-id="environments-conda-name">
							{displayName}
						</SummaryCard.Title>
						<SummaryCard.Description data-qa-id="environments-conda-prefix">
							{env.prefix}
						</SummaryCard.Description>
					</SummaryCard.Content>
				</SummaryCard.Button>
				{isNamelessEnv(env) ? null : (
					<SummaryCard.Actions>
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button
										type="button"
										variant="ghost"
										size="icon-sm"
										aria-label={`Actions for ${displayName}`}
										data-qa-id="environments-row-actions"
									/>
								}
							>
								<EllipsisIcon />
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onClick={onClone} data-qa-id="environments-row-clone">
									<CopyIcon />
									Clone
								</DropdownMenuItem>
								<DropdownMenuItem
									variant="destructive"
									onClick={onDelete}
									data-qa-id="environments-row-delete"
								>
									<Trash2Icon />
									Delete
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</SummaryCard.Actions>
				)}
			</SummaryCard.Row>
		</li>
	);
}
