import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BookMarkedIcon, LockIcon, RefreshCwIcon, SearchIcon } from "lucide-react";
import { useDeferredValue, useRef, useState, type ReactNode } from "react";

import { KernelOs } from "@kilo-desktop/kernel";
import { useDomainObject } from "@kilo-desktop/kernel/web";
import type {
	WorkspaceSourceImplementation,
	WorkspaceSourceProps,
} from "@kilo-desktop/plugin-work-sessions/contracts";
import { Button } from "@kilo-desktop/ui/components/button";
import { Command, CommandEmpty } from "@kilo-desktop/ui/components/command";
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
import { Skeleton } from "@kilo-desktop/ui/components/skeleton";
import { Spinner } from "@kilo-desktop/ui/components/spinner";
import { cn } from "@kilo-desktop/ui/lib/utils";

import {
	Clone,
	GithubRepositories,
	Repository,
	type GithubCliStatus,
	type GithubRepository,
} from "../../contracts";
import { CloneErrorAlert, errorMessage, gitUnavailable } from "./clone-errors";
import { FILLED_INPUT_GROUP_CLASS, FILLED_PANEL_CLASS } from "@kilo-desktop/ui/lib/filled-styles";
import { GithubMark } from "./github-mark";
import { listEntries, RepositoryList, TYPED_REPOSITORY_VALUE } from "./RepositoryList";
import {
	GITHUB_REPOSITORIES_KEY,
	GITHUB_STATUS_KEY,
	githubStatusQuery,
	useGithubRepositories,
} from "./github-queries";

/** What the details step needs about the chosen repository. */
interface SelectedRepository {
	/** Cloned as-is: `owner/name`. */
	readonly repository: string;
	/** The default workspace and folder name. */
	readonly name: string;
	readonly isPrivate: boolean;
}

const GITHUB_CLI_URL = "https://cli.github.com/";
/** A cheap shape check; main validates what it clones properly. */
const TYPED_REPOSITORY = /^(?:[\w.-]+\/[\w.-]+|https?:\/\/\S+\/[\w.-]+\/[\w.-]+\/?|git@\S+:\S+)$/;

function selection(repository: GithubRepository): SelectedRepository {
	return {
		repository: repository.nameWithOwner,
		name: repository.name,
		isPrivate: repository.isPrivate,
	};
}

/** Clones a GitHub repository with the GitHub CLI: pick one, then name and place it. */
function GithubRepositorySource({ NewFolderForm, appearance, children }: WorkspaceSourceProps) {
	const clone = useDomainObject(Clone);
	const [selected, setSelected] = useState<SelectedRepository | null>(null);
	if (!selected) {
		return <RepositoryPicker appearance={appearance} present={children} onSelect={setSelected} />;
	}
	return (
		<NewFolderForm
			description="Name the workspace and choose where to clone it."
			choice={{
				label: selected.repository,
				icon: selected.isPrivate ? LockIcon : BookMarkedIcon,
				changeLabel: "Choose another repository",
				onChange: () => setSelected(null),
				qaId: "github-repository-chosen",
			}}
			suggestedName={selected.name}
			pendingLabel="Cloning…"
			errorTitle="Couldn't clone the repository"
			create={async (details) =>
				(clone ?? gitUnavailable()).methods.cloneWorkspace({
					...details,
					source: { kind: "github", repository: selected.repository },
				})
			}
		/>
	);
}

/**
 * Everything the signed-in GitHub CLI user can reach, most recently pushed
 * first, with a filter; a typed `owner/name` or URL covers what the list
 * doesn't show (an organization's third-party app policy can hide some).
 */
function RepositoryPicker({
	appearance,
	present,
	onSelect,
}: {
	appearance: WorkspaceSourceProps["appearance"];
	present: WorkspaceSourceProps["children"];
	onSelect(selected: SelectedRepository): void;
}) {
	const queries = useQueryClient();
	const repository = useDomainObject(Repository);
	const github = useDomainObject(GithubRepositories);
	const os = useDomainObject(KernelOs);
	const unavailable = repository === null || github === null;
	const status = useQuery(githubStatusQuery(repository));
	const cliStatus = status.data?.status ?? "error";
	const isReady = cliStatus === "ready";
	const noticeStatus: NoticeStatus | null = unavailable
		? "unavailable"
		: !status.isPending && cliStatus !== "ready"
			? cliStatus
			: null;
	const repositories = useGithubRepositories(github, isReady);
	const recheck = useMutation({
		mutationFn: () => (repository ?? gitUnavailable()).methods.githubCliStatus({ force: true }),
		onSuccess: (result) => queries.setQueryData(GITHUB_STATUS_KEY, result),
	});
	const reload = useMutation({
		mutationFn: () => (github ?? gitUnavailable()).methods.list({ refresh: true }),
		onSuccess: (result) => queries.setQueryData(GITHUB_REPOSITORIES_KEY, result),
	});
	const isRefreshing = reload.isPending || repositories.data?.refreshing === true;
	// A typed repository isn't in the list, so confirm it exists (and take its
	// canonical name) here rather than failing later, mid-clone.
	const verify = useMutation({
		mutationFn: (typedRepository: string) =>
			(github ?? gitUnavailable()).methods.resolve({ repository: typedRepository }),
		onSuccess: (resolved) => onSelect(selection(resolved)),
	});

	const [search, setSearch] = useState("");
	const query = useDeferredValue(search.trim().toLowerCase());
	const all = repositories.data?.repositories ?? [];
	const filtered = query
		? all.filter((candidate) => candidate.nameWithOwner.toLowerCase().includes(query))
		: all;
	const typed = search.trim();
	const offerTyped =
		TYPED_REPOSITORY.test(typed) &&
		!all.some((candidate) => candidate.nameWithOwner.toLowerCase() === typed.toLowerCase());
	// cmdk highlights the first match itself only when its own input drives
	// the search, so the plain field keeps the highlight on the first option
	// until the person arrows elsewhere; Enter then picks it. Listed
	// repositories come first, so a partly typed name never sends Enter to
	// the unverified entry.
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const entries = listEntries(filtered, offerTyped);
	const firstOption = filtered[0]?.nameWithOwner ?? (offerTyped ? TYPED_REPOSITORY_VALUE : "");
	const scrollToHighlighted = useRef<((value: string) => void) | null>(null);

	const filled = appearance === "filled";

	return present({
		description: "Choose a repository to clone.",
		primary: null,
		body: noticeStatus ? (
			<GithubCliNotice
				filled={filled}
				status={noticeStatus}
				checking={recheck.isPending}
				onCheckAgain={() => recheck.mutate()}
				onInstall={() => void os?.methods.openExternal({ url: GITHUB_CLI_URL })}
			/>
		) : (
			<div className="flex min-w-0 flex-col gap-2">
				{/* A bare cmdk root: its keydown handling still drives arrow and
					    Enter navigation from the plain search field above the list. */}
				<Command
					label="Repositories"
					shouldFilter={false}
					value={highlighted ?? firstOption}
					onValueChange={(next) => {
						setHighlighted(next);
						scrollToHighlighted.current?.(next);
					}}
					className="gap-2 overflow-visible rounded-none! bg-transparent p-0"
				>
					<div className="flex items-center gap-2">
						<InputGroup className={cn("flex-1", filled && FILLED_INPUT_GROUP_CLASS)}>
							<InputGroupInput
								type="search"
								value={search}
								onChange={(event) => {
									setSearch(event.currentTarget.value);
									setHighlighted(null);
									verify.reset();
								}}
								placeholder="Search repositories or enter owner/name"
								aria-label="Search repositories or enter owner/name"
								autoFocus
								data-qa-id="github-repository-search"
							/>
							<InputGroupAddon>
								<SearchIcon aria-hidden="true" />
							</InputGroupAddon>
						</InputGroup>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Reload repositories"
							disabled={!isReady || repositories.isPending || isRefreshing}
							onClick={() => reload.mutate()}
						>
							<RefreshCwIcon className={isRefreshing ? "animate-spin" : undefined} />
						</Button>
					</div>
					<RepositoryList
						entries={entries}
						typed={typed}
						verifying={verify.isPending}
						scrollToRef={scrollToHighlighted}
						onSelect={(candidate) => onSelect(selection(candidate))}
						onSelectTyped={() => verify.mutate(typed)}
						placeholder={
							// Loading also covers the GitHub CLI check: the list waits on it.
							repositories.isPending ? (
								<RepositoryListSkeleton />
							) : repositories.isSuccess ? (
								<CommandEmpty>
									{all.length === 0
										? "No repositories found for this GitHub account."
										: "No repositories match your search."}
								</CommandEmpty>
							) : null
						}
					/>
				</Command>
				{verify.isError ? (
					<CloneErrorAlert
						title={`Can't use ${typed}`}
						message={errorMessage(verify.error, "The repository could not be looked up.")}
					/>
				) : null}
				{repositories.isError || reload.isError ? (
					<CloneErrorAlert
						title="Couldn't load your repositories"
						message={errorMessage(
							reload.error ?? repositories.error,
							"The repository list could not be loaded.",
						)}
					/>
				) : null}
			</div>
		),
	});
}

/** Varied so the placeholder reads as a list of names rather than a block. */
const SKELETON_NAME_WIDTHS = [
	"7rem",
	"10rem",
	"5.5rem",
	"8.5rem",
	"6rem",
	"11rem",
	"7.5rem",
	"9rem",
];

/** Mirrors one owner's section of rows, so the box keeps its size when the list arrives. */
function RepositoryListSkeleton() {
	return (
		<div role="status" className="flex flex-col">
			<span className="sr-only">Loading repositories…</span>
			<div className="px-1.5 py-1" aria-hidden="true">
				<Skeleton className="h-3 w-16" />
			</div>
			{SKELETON_NAME_WIDTHS.map((width) => (
				<div key={width} className="flex h-7 items-center gap-1.5 px-1.5" aria-hidden="true">
					<Skeleton className="size-3.5 shrink-0 rounded-sm" />
					<Skeleton className="h-3.5" style={{ width }} />
				</div>
			))}
		</div>
	);
}

type NoticeStatus = Exclude<GithubCliStatus, "ready"> | "unavailable";

const NOTICES: Record<NoticeStatus, { title: string; description: ReactNode; install?: boolean }> =
	{
		missing: {
			title: "Install the GitHub CLI",
			description:
				"Repositories are listed and cloned with the GitHub CLI (gh). Install it, then check again.",
			install: true,
		},
		unauthenticated: {
			title: "Sign in to the GitHub CLI",
			description: (
				<>
					Run <code>gh auth login</code> in a terminal, then check again.
				</>
			),
		},
		timeout: {
			title: "The GitHub CLI isn't responding",
			description: "Check your network connection, then check again.",
		},
		error: {
			title: "Couldn't reach the GitHub CLI",
			description: (
				<>
					Run <code>gh auth status</code> in a terminal to see what&apos;s wrong, then check again.
				</>
			),
		},
		unavailable: {
			title: "GitHub is unavailable",
			description: "Cloning GitHub repositories requires the desktop app.",
		},
	};

function GithubCliNotice({
	filled,
	status,
	checking,
	onCheckAgain,
	onInstall,
}: {
	filled: boolean;
	status: NoticeStatus;
	checking: boolean;
	onCheckAgain(): void;
	onInstall(): void;
}) {
	const notice = NOTICES[status];
	return (
		<Empty className={filled ? FILLED_PANEL_CLASS : "border"}>
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<GithubMark />
				</EmptyMedia>
				<EmptyTitle>{notice.title}</EmptyTitle>
				<EmptyDescription>{notice.description}</EmptyDescription>
			</EmptyHeader>
			<EmptyContent className="flex-row justify-center">
				{notice.install ? (
					<Button type="button" variant="outline" size="sm" onClick={onInstall}>
						Get GitHub CLI
					</Button>
				) : null}
				{status === "unavailable" ? null : (
					<Button type="button" size="sm" disabled={checking} onClick={onCheckAgain}>
						{checking ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
						Check again
					</Button>
				)}
			</EmptyContent>
		</Empty>
	);
}

export const githubRepositorySource: WorkspaceSourceImplementation = {
	icon: GithubMark,
	Component: GithubRepositorySource,
};
