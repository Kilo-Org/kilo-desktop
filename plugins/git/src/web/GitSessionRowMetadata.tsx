import { GitPullRequestIcon } from "lucide-react";

import { useSdk } from "@kilo-desktop/sdk-react";
import { ExternalLink } from "@kilo-desktop/ui/components/external-link";

import type { GitServiceContract } from "../contracts/schemas.js";
import { pullRequestClassName } from "./repository-actions.js";
import { useSessionPullRequest } from "./use-session-pull-request.js";

export interface GitSessionRowMetadataProps {
	readonly statusId: string;
	readonly directory: string;
	readonly worktreeBranch?: string;
	/** The host lets the badge be clicked on its own (board cards), so it links to the PR. */
	readonly interactive?: boolean;
}

export function GitSessionRowMetadata({ directory, interactive }: GitSessionRowMetadataProps) {
	const sdk = useSdk<GitServiceContract>("git");
	const pullRequest = useSessionPullRequest(directory);

	if (!pullRequest) return null;
	const stateClassName = pullRequestClassName(pullRequest);
	const label = `PR #${pullRequest.number}: ${pullRequest.title}`;
	const badge = (
		<>
			<GitPullRequestIcon className="size-3" aria-hidden />#{pullRequest.number}
		</>
	);

	if (!interactive) {
		return (
			<span
				className={`ml-auto flex shrink-0 items-center gap-1 pl-3 tabular-nums ${stateClassName}`}
				title={label}
			>
				{badge}
			</span>
		);
	}
	// The host lays it out among its own details and leaves the pointer to it.
	return (
		<ExternalLink
			href={pullRequest.url}
			onOpen={(url) => void sdk.shell.openExternal(url).catch(() => undefined)}
			aria-label={`View ${label}`}
			title={label}
			data-qa-id="git-session-row-pull-request"
			// A native link drag would cancel the board's own pointer drag of the card.
			draggable={false}
			className={`focus-visible:ring-ring pointer-events-auto flex shrink-0 items-center gap-1 rounded-sm tabular-nums hover:underline focus-visible:ring-2 focus-visible:outline-none ${stateClassName}`}
		>
			{badge}
		</ExternalLink>
	);
}
