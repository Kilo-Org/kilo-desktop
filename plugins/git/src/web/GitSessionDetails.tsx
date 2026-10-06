import { ExternalLinkIcon, GitBranchIcon, GitPullRequestIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { sdkQueryOptions, useSdk } from "@kilo-desktop/sdk-react";
import { ExternalLink } from "@kilo-desktop/ui/components/external-link";

import type { GitServiceContract } from "../contracts/schemas.js";
import { useGitPrStatusStore } from "./git-pr-status-store.js";
import { pullRequestClassName } from "./repository-actions.js";
import { useSessionPullRequest } from "./use-session-pull-request.js";

export interface GitSessionDetailsProps {
	readonly statusId: string;
	readonly directory: string;
	readonly worktreeBranch?: string;
}

/**
 * Branch line for the session hover card (`kilo-ui/chat-session-details-branch`).
 * The card mounts only while open, so the live `branches` probe runs on
 * demand — gated on the repository-type probe, so a non-repo directory never
 * spawns the failing `for-each-ref`; the cached PR snapshot and the stamped
 * worktree branch fill in until it answers (or when the directory is not a
 * repository). Renders nothing when no branch is known.
 */
export function GitSessionDetailsBranch({
	statusId,
	directory,
	worktreeBranch,
}: GitSessionDetailsProps) {
	const sdk = useSdk<GitServiceContract>("git");
	const cachedBranch = useGitPrStatusStore(
		(state) => state.snapshots[statusId]?.snapshot.branch ?? undefined,
	);
	// Only a regular repository has branches to probe: gate the live query on
	// the repository-type probe so a non-repo directory never spawns a failing
	// `for-each-ref` (the cached snapshot and stamped worktree branch fill in).
	const typeQuery = useQuery(
		sdkQueryOptions(sdk, "repositoryType", { workingDirectory: directory }),
	);
	const query = useQuery({
		...sdkQueryOptions(sdk, "branches", { workingDirectory: directory }),
		enabled: typeQuery.data?.kind === "regular",
		retry: false,
	});
	const branch = query.data
		? (query.data.currentBranch ?? "Detached HEAD")
		: (cachedBranch ?? worktreeBranch);

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

/**
 * Pull request link for the session hover card
 * (`kilo-ui/chat-session-details-pull-request`). Renders nothing without a PR.
 */
export function GitSessionDetailsPullRequest({ directory }: GitSessionDetailsProps) {
	const sdk = useSdk<GitServiceContract>("git");
	const pullRequest = useSessionPullRequest(directory);

	if (!pullRequest) return null;

	return (
		<ExternalLink
			href={pullRequest.url}
			onOpen={(url) => void sdk.shell.openExternal(url).catch(() => undefined)}
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
