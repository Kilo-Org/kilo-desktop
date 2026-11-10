import { definePlugin, type PluginSdk } from "@kilo-desktop/kernel";
import { FileWatcher } from "@kilo-desktop/plugin-work-sessions/contracts";

import { Repository } from "../contracts";
import { activateActions } from "./actions";
import { activateBranches } from "./branches";
import { activateChanges } from "./changes";
import { activatePullRequests } from "./pull-requests";
import { refetchOnWindowFocus } from "./shared/focus-refetch";
import type { GitWindow } from "./shared/git-window";
import { createGitQueryClient, invalidateRepositoryQueries } from "./shared/repository-queries";
import { watchRepositoryQueries } from "./shared/repository-watcher";

/** Keeps the window's repository reads current from file changes and branch renames. */
function keepRepositoryReadsCurrent(sdk: PluginSdk, { queries }: GitWindow): void {
	sdk.onDispose(refetchOnWindowFocus(queries));
	let stopWatching: (() => void) | undefined;
	sdk.onDispose(
		sdk.domainObjects.track(FileWatcher, {
			added: (fileWatcher) => {
				stopWatching = watchRepositoryQueries(fileWatcher, queries);
			},
			removed: () => stopWatching?.(),
		}),
	);
	sdk.onDispose(() => stopWatching?.());
	let stopRenames: (() => void) | undefined;
	sdk.onDispose(
		sdk.domainObjects.track(Repository, {
			added: (repository) => {
				stopRenames = repository.on("worktree-branch-renamed", () => {
					void invalidateRepositoryQueries(queries, ["branches", "status"]);
				});
			},
			removed: () => stopRenames?.(),
		}),
	);
	sdk.onDispose(() => stopRenames?.());
}

/**
 * kilo.git's window entry, composed from areas that share one cache of
 * repository reads, kept current from kilo.work-sessions' file changes and
 * worktree branch renames: the Changes pane and Open Changes (`changes`), the
 * branch under a chat's composer and on the New Session page (`branches`),
 * the open work session's commit / push / pull request actions and their
 * commands (`actions`), and work sessions' pull requests — row badge, hover
 * details, the session list's filter facet — with the directories this window
 * shows reported to `kilo.git/pull-requests` (`pull-requests`).
 */
export const gitWebEntry = definePlugin({
	activate(sdk) {
		const window: GitWindow = { queries: createGitQueryClient() };
		sdk.onDispose(() => window.queries.clear());
		keepRepositoryReadsCurrent(sdk, window);
		activateChanges(sdk, window);
		activateBranches(sdk, window);
		activateActions(sdk, window);
		activatePullRequests(sdk, window);
	},
});
