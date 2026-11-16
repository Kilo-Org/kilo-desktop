import { githubRepositoryUrl } from "../../contracts";

export { githubRepositoryUrl };

export type RepositoryActionPullRequest = {
	number: number;
	url: string;
	title: string;
	state: "open" | "closed" | "merged";
	isDraft: boolean;
};

export type RepositoryActionStatus = {
	currentBranch?: string | undefined;
	currentUpstreamBranch?: string | undefined;
	branchAheadBehind?: { ahead: number; behind: number } | undefined;
	workingDirectory: { files: readonly unknown[] };
};

export type RepositoryActionInput = {
	status: RepositoryActionStatus;
	origin: string | null;
	defaultBranch: string | null;
	pullRequest: RepositoryActionPullRequest | null;
};

export type RepositoryActionKind =
	| "disabled"
	| "commit"
	| "commit-push"
	| "commit-push-pr"
	| "pull"
	| "view-pr"
	| "push"
	| "create-pr";

export type RepositoryMenuAction = {
	id: "commit" | "push" | "view-pr" | "create-pr";
	label: string;
	disabledReason: string | null;
	className?: string;
};

export type RepositoryActionModel = {
	currentBranch: string | undefined;
	hasChanges: boolean;
	filesChanged: number;
	hasUpstream: boolean;
	ahead: number;
	behind: number;
	repositoryUrl: string | null;
	defaultBranch: string | null;
	isDefaultBranch: boolean;
	confirmQuickAction: boolean;
	pullRequest: RepositoryActionPullRequest | null;
	commitDisabled: string | null;
	pushDisabled: string | null;
	prDisabled: string | null;
	quickAction: {
		label: string;
		kind: RepositoryActionKind;
		disabledReason: string | null;
	};
	menu: readonly RepositoryMenuAction[];
};

export function normalizeDefaultBranch(name: string | null | undefined): string | null {
	return name?.replace(/^origin\//, "") ?? null;
}

export function pullRequestClassName(
	pullRequest: Pick<RepositoryActionPullRequest, "state" | "isDraft"> | null,
): string | null {
	if (!pullRequest) return null;
	if (pullRequest.state === "open" && pullRequest.isDraft) return "text-muted-foreground";
	if (pullRequest.state === "open") return "text-emerald-600 dark:text-emerald-300";
	if (pullRequest.state === "merged") return "text-violet-600 dark:text-violet-300";
	return "text-red-600 dark:text-red-300";
}

export function repositoryActions(input: RepositoryActionInput): RepositoryActionModel {
	const currentBranch = input.status.currentBranch;
	const hasChanges = input.status.workingDirectory.files.length > 0;
	const hasUpstream = Boolean(input.status.currentUpstreamBranch);
	const ahead = input.status.branchAheadBehind?.ahead ?? 0;
	const behind = input.status.branchAheadBehind?.behind ?? 0;
	const repositoryUrl = input.origin ? githubRepositoryUrl(input.origin) : null;
	const isDefaultBranch = currentBranch !== undefined && currentBranch === input.defaultBranch;
	const commitDisabled = hasChanges ? null : "Worktree is clean.";
	const pushDisabled = !currentBranch
		? "Checkout a branch before pushing."
		: !input.origin
			? 'Add an "origin" remote before pushing.'
			: behind > 0
				? "Branch is behind its upstream. Pull or rebase first."
				: ahead === 0 && hasUpstream
					? "No local commits to push."
					: null;
	// A closed or merged PR still links from the menu, but the branch may
	// open a new one; only an open PR replaces "Create PR".
	const openPullRequest = input.pullRequest?.state === "open" ? input.pullRequest : null;
	const createPrDisabled = !currentBranch
		? "Checkout a branch before creating a pull request."
		: hasChanges
			? "Commit local changes before creating a pull request."
			: !repositoryUrl
				? "Pull request creation currently requires a GitHub origin remote."
				: !input.defaultBranch
					? "The repository default branch could not be detected."
					: currentBranch === input.defaultBranch
						? "Create a feature branch before opening a pull request."
						: behind > 0
							? "Branch is behind its upstream. Pull or rebase first."
							: null;
	const prDisabled = openPullRequest ? null : createPrDisabled;
	const isDiverged = ahead > 0 && behind > 0;
	const quickAction = !currentBranch
		? { label: "Commit", kind: "disabled" as const }
		: hasChanges
			? !input.origin || behind > 0
				? { label: "Commit", kind: "commit" as const }
				: openPullRequest || isDefaultBranch || !repositoryUrl || !input.defaultBranch
					? { label: "Commit & push", kind: "commit-push" as const }
					: { label: "Commit, push & PR", kind: "commit-push-pr" as const }
			: isDiverged
				? { label: "Sync branch", kind: "disabled" as const }
				: behind > 0
					? { label: "Pull", kind: "pull" as const }
					: openPullRequest
						? { label: "View PR", kind: "view-pr" as const }
						: pushDisabled === null
							? { label: "Push", kind: "push" as const }
							: input.pullRequest
								? { label: "View PR", kind: "view-pr" as const }
								: createPrDisabled === null
									? { label: "Create PR", kind: "create-pr" as const }
									: { label: "Commit", kind: "disabled" as const };
	const disabledReason =
		quickAction.kind !== "disabled"
			? null
			: !currentBranch
				? "Checkout a branch before running repository actions."
				: isDiverged
					? "Branch has diverged from upstream. Rebase or merge first."
					: "Branch is up to date. No action needed.";
	const className = pullRequestClassName(input.pullRequest);

	return {
		currentBranch,
		hasChanges,
		filesChanged: input.status.workingDirectory.files.length,
		hasUpstream,
		ahead,
		behind,
		repositoryUrl,
		defaultBranch: input.defaultBranch,
		isDefaultBranch,
		confirmQuickAction:
			isDefaultBranch && (quickAction.kind === "commit-push" || quickAction.kind === "push"),
		pullRequest: input.pullRequest,
		commitDisabled,
		pushDisabled,
		prDisabled,
		quickAction: { ...quickAction, disabledReason },
		menu: [
			{ id: "commit", label: "Commit", disabledReason: commitDisabled },
			{ id: "push", label: "Push", disabledReason: pushDisabled },
			...(input.pullRequest
				? [
						{
							id: "view-pr" as const,
							label: `PR #${input.pullRequest.number}`,
							disabledReason: null,
							...(className ? { className } : {}),
						},
					]
				: []),
			...(openPullRequest
				? []
				: [{ id: "create-pr" as const, label: "Create PR", disabledReason: createPrDisabled }]),
		],
	};
}
