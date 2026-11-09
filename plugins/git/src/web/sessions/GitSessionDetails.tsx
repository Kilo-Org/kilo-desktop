import { useQuery } from "@tanstack/react-query";
import { ExternalLinkIcon, GitBranchIcon, GitPullRequestIcon } from "lucide-react";
import { useCallback } from "react";

import { KernelShell } from "@kilo-desktop/kernel";
import { useDomain } from "@kilo-desktop/kernel/web";
import type { SessionDecorationProps } from "@kilo-desktop/plugin-sessions/contracts";
import { ExternalLink } from "@kilo-desktop/ui/components/external-link";

import { Repository } from "../../contracts/index.js";
import {
	useDirectoryPullRequest,
	usePullRequestEntry,
	useSessionDirectory,
} from "../pull-requests/use-pull-request.js";
import { pullRequestClassName } from "../repository-actions.js";
import { branchesQuery, repositoryTypeQuery } from "../repository-queries.js";

/** Opens a URL in the person's browser through kernel/shell; failures are ignored. */
export function useOpenExternal(): (url: string) => void {
	const shell = useDomain(KernelShell);
	return useCallback(
		(url: string) => void shell?.methods.openExternal({ url }).catch(() => undefined),
		[shell],
	);
}

/**
 * The session row's pull request badge (`row` decoration); nothing without a
 * pull request. Where the surface allows (`interactive`, a board card) it
 * opens the pull request in the browser.
 */
export function GitSessionRowBadge({ session, interactive = false }: SessionDecorationProps) {
	const pullRequest = useDirectoryPullRequest(useSessionDirectory(session));
	const openExternal = useOpenExternal();
	if (!pullRequest) return null;
	const className = `ml-auto flex shrink-0 items-center gap-1 pl-3 tabular-nums ${pullRequestClassName(pullRequest)}`;
	const title = `PR #${pullRequest.number}: ${pullRequest.title}`;
	const content = (
		<>
			<GitPullRequestIcon className="size-3" aria-hidden />#{pullRequest.number}
		</>
	);
	if (!interactive) {
		return (
			<span data-qa-id="git-session-row-pull-request" className={className} title={title}>
				{content}
			</span>
		);
	}
	return (
		<ExternalLink
			href={pullRequest.url}
			onOpen={openExternal}
			data-qa-id="git-session-row-pull-request"
			title={title}
			draggable={false}
			className={`${className} focus-visible:ring-ring rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none`}
		>
			{content}
		</ExternalLink>
	);
}

/**
 * The branch line of the session's hover details (`hover-branch`
 * decoration). The card mounts only while open, so the live `branches`
 * probe runs on demand — gated on the repository-type probe, so a non-repo
 * directory never spawns the failing `for-each-ref`; the last pull request
 * lookup's branch and the stamped worktree branch fill in until it answers
 * (or when the directory is not a repository). Nothing when no branch is
 * known.
 */
export function GitSessionDetailsBranch({ session }: SessionDecorationProps) {
	const repository = useDomain(Repository);
	const sessionDirectory = useSessionDirectory(session);
	const directory = session.directory ?? sessionDirectory ?? "";
	const lookedUpBranch = usePullRequestEntry(directory || null)?.snapshot.branch ?? undefined;
	const typeQuery = useQuery(repositoryTypeQuery(repository, directory));
	const query = useQuery({
		...branchesQuery(repository, directory),
		enabled: repository !== null && typeQuery.data?.kind === "regular",
	});
	const branch = query.data
		? (query.data.currentBranch ?? "Detached HEAD")
		: (lookedUpBranch ?? session.worktreeBranch ?? undefined);

	if (!branch) return null;
	return (
		<span data-qa-id="git-session-details-branch" className="flex min-w-0 items-center gap-1.5">
			<GitBranchIcon className="size-3 shrink-0 opacity-70" aria-hidden />
			<span className="truncate" title={branch}>
				{branch}
			</span>
		</span>
	);
}

/** The pull request link of the session's hover details (`hover` decoration). */
export function GitSessionDetailsPullRequest({ session }: SessionDecorationProps) {
	const pullRequest = useDirectoryPullRequest(useSessionDirectory(session));
	const openExternal = useOpenExternal();
	if (!pullRequest) return null;
	return (
		<ExternalLink
			href={pullRequest.url}
			onOpen={openExternal}
			data-qa-id="git-session-details-pull-request"
			title={pullRequest.url}
			className="group/pr focus-visible:ring-ring flex min-w-0 items-center gap-1.5 rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
		>
			<span
				className={`flex shrink-0 items-center gap-1 tabular-nums ${pullRequestClassName(pullRequest)}`}
			>
				<GitPullRequestIcon className="size-3" aria-hidden />#{pullRequest.number}
			</span>
			<span className="truncate">{pullRequest.title}</span>
			<ExternalLinkIcon
				className="size-3 shrink-0 opacity-0 transition-opacity group-hover/pr:opacity-70 group-focus-visible/pr:opacity-70"
				aria-hidden
			/>
		</ExternalLink>
	);
}
