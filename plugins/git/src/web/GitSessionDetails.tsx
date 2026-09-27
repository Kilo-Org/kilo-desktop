import { ExternalLinkIcon, GitBranchIcon, GitPullRequestIcon } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { sdkQueryOptions, useSdk } from "@kilo-desktop/sdk-react";

import type { GitServiceContract } from "../contracts/schemas.js";
import { selectPullRequest, useGitPrStatusStore } from "./git-pr-status-store.js";
import { pullRequestClassName } from "./repository-actions.js";

export interface GitSessionDetailsProps {
	readonly statusId: string;
	readonly directory: string;
	readonly worktreeBranch?: string;
}

/**
 * Branch line for the session hover card (`kilo-ui/chat-session-details-branch`).
 * The card mounts only while open, so the live `branches` probe runs on
 * demand; the cached PR snapshot and the stamped worktree branch fill in
 * until it answers (or when the directory is not a repository). Renders
 * nothing when no branch is known.
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
	const query = useQuery({
		...sdkQueryOptions(sdk, "branches", { workingDirectory: directory }),
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
export function GitSessionDetailsPullRequest({ statusId, worktreeBranch }: GitSessionDetailsProps) {
	const sdk = useSdk<GitServiceContract>("git");
	const pullRequest = useGitPrStatusStore((state) =>
		selectPullRequest(state, {
			statusId,
			...(worktreeBranch ? { branch: worktreeBranch } : {}),
		}),
	);

	if (!pullRequest) return null;

	return (
		<a
			href={pullRequest.url}
			data-qa-id="git-session-details-pull-request"
			title={pullRequest.url}
			className="group/pr focus-visible:ring-ring flex min-w-0 items-center gap-1.5 rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
			onClick={(event) => {
				event.preventDefault();
				void sdk.shell.openExternal(pullRequest.url);
			}}
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
		</a>
	);
}
