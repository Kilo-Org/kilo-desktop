import { GitPullRequestIcon } from "lucide-react";

import { selectPullRequest, useGitPrStatusStore } from "./git-pr-status-store.js";
import { pullRequestClassName } from "./repository-actions.js";

export interface GitSessionRowMetadataProps {
	readonly statusId: string;
	readonly directory: string;
	readonly worktreeBranch?: string;
}

export function GitSessionRowMetadata({ statusId, worktreeBranch }: GitSessionRowMetadataProps) {
	const pullRequest = useGitPrStatusStore((state) =>
		selectPullRequest(state, {
			statusId,
			...(worktreeBranch ? { branch: worktreeBranch } : {}),
		}),
	);

	if (!pullRequest) return null;
	const className = pullRequestClassName(pullRequest);

	return (
		<span
			className={`ml-auto flex shrink-0 items-center gap-1 pl-3 tabular-nums ${className}`}
			title={`PR #${pullRequest.number}: ${pullRequest.title}`}
		>
			<GitPullRequestIcon className="size-3" aria-hidden />#{pullRequest.number}
		</span>
	);
}
