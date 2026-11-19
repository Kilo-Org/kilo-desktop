import { definePlugin, type PluginEntry } from "@kilo-desktop/kernel";

import { activateBranchNamer } from "./branch-namer";
import { activateChangesTool } from "./changes-tool";
import { activateClone } from "./clone";
import { activatePullRequests } from "./pull-requests";
import { activateRepository, type RepositoryOptions } from "./repository";
import type { PullRequestSource } from "./shared/pull-request-source";

export interface GitMainOptions extends RepositoryOptions {
	/** Replaces the pull request lookups (tests). */
	readonly pullRequestSource?: PullRequestSource;
	/** The clock pull request snapshots are stamped with (tests). */
	readonly now?: () => number;
}

/**
 * kilo.git in main, composed from areas that meet only through kilo.git's
 * own contracts and the plugins below it: the repository (one git service
 * behind `kilo.git/repository`, the `kilo.work-sessions/vcs` contribution and
 * the `kilo-git` patch protocol), cloning a repository into a new workspace
 * (`kilo.git/github-repositories` and the repository's `cloneWorkspace`,
 * cloning URLs with the repository's git client), the pull request of each
 * work session's directory, the branch namer that renames a new copy's
 * branch once its chat's task is clear, and the agent's `changes_open`
 * tool. Every area works
 * without kilo.work-sessions and kilo.core, following them as they come and go.
 */
export function createGitMainEntry(options: GitMainOptions = {}): PluginEntry {
	return definePlugin({
		activate(sdk) {
			const repository = activateRepository(sdk, options, (cloneGitUrl) =>
				activateClone(sdk, { cloneGitUrl }),
			);
			activatePullRequests(sdk, {
				source: options.pullRequestSource ?? repository.pullRequestSource,
				...(options.now ? { now: options.now } : {}),
			});
			activateBranchNamer(sdk, { vcs: repository.vcs });
			activateChangesTool(sdk);
		},
	});
}
