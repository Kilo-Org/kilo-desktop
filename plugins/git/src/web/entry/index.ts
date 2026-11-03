import { definePlugin, KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";
import { toast } from "@kilo-desktop/ui/components/sonner";
import { ComposerAction } from "@kilo-desktop/plugin-chat/contracts";
import { PaneKind, Panes, SessionDecoration } from "@kilo-desktop/plugin-sessions/contracts";
import {
	LauncherOption,
	Navigator,
	PaneLauncher,
	SessionAction,
	SessionFacet,
} from "@kilo-desktop/plugin-workbench/contracts";
import { Files } from "@kilo-desktop/plugin-workspaces/contracts";

import { Repository } from "../../contracts/index.js";
import {
	ActionProgress,
	ActionRequests,
	type RequestedAction,
} from "../actions/action-progress.js";
import { createGitSessionActions } from "../actions/GitActionsControl.js";
import { GitBranchSelector } from "../branches/GitBranchSelector.js";
import { ChangesIcon, ChangesPane } from "../changes/ChangesPane.js";
import { showChanges } from "../changes/show-changes.js";
import { createPullRequestFacet, reportShownDirectories } from "../pull-requests/window-sources.js";
import {
	createGitQueryClient,
	invalidateRepositoryQueries,
	withRepositoryQueries,
} from "../repository-queries.js";
import { refetchOnWindowFocus } from "../focus-refetch.js";
import { watchRepositoryQueries } from "../repository-watcher.js";
import {
	GitSessionDetailsBranch,
	GitSessionDetailsPullRequest,
	GitSessionRowBadge,
} from "../sessions/GitSessionDetails.js";
import { GitBranchFooter } from "./GitBranchFooter.js";

/** Shows the Changes pane of the session this window has open. */
async function openChanges(sdk: PluginSdk): Promise<void> {
	const sessionId = sdk.domains.get(Navigator)?.getState().activeSessionId;
	if (!sessionId) return;
	await showChanges(sdk.domains.get(PaneLauncher), sdk.domains.get(Panes), sessionId);
}

/** Hands a command to the open session's repository control. */
function requestAction(requests: ActionRequests, action: RequestedAction): void {
	if (requests.request(action)) return;
	toast.error("No repository actions here", {
		description: "Open a session in a git repository first.",
	});
}

/**
 * kilo.git's renderer entry: the branch under a chat's composer, the Changes
 * pane, the launcher's branch picker, Open Changes, and sessions' pull
 * requests (row badge, hover details, the session list's filter facet), the
 * open session's commit / push / pull request actions and their commands. The
 * window keeps one cache of repository reads for them, kept current from
 * kilo.workspaces' file changes and worktree branch renames, and tells
 * `kilo.git/pull-requests` which directory it shows. The main window toasts
 * worktree branch renames (main can't).
 */
export const gitWebEntry = definePlugin({
	activate(sdk) {
		const queries = createGitQueryClient();
		sdk.onDispose(() => queries.clear());
		sdk.onDispose(refetchOnWindowFocus(queries));
		let stopWatching: (() => void) | undefined;
		sdk.onDispose(
			sdk.domains.track(Files, {
				added: (files) => {
					stopWatching = watchRepositoryQueries(files, queries);
				},
				removed: () => stopWatching?.(),
			}),
		);
		sdk.onDispose(() => stopWatching?.());
		let stopRenames: (() => void) | undefined;
		sdk.onDispose(
			sdk.domains.track(Repository, {
				added: (repository) => {
					stopRenames = repository.on("worktree-branch-renamed", ({ branch }) => {
						void invalidateRepositoryQueries(queries, ["branches", "status"]);
						if (!sdk.context.get("kernel/secondaryWindow")) {
							toast.success(`Branch renamed to ${branch}`);
						}
					});
				},
				removed: () => stopRenames?.(),
			}),
		);
		sdk.onDispose(() => stopRenames?.());
		reportShownDirectories(sdk, sdk.windowId ?? "main");

		sdk.extensions.implement(ComposerAction, "branch", {
			kind: "view",
			Component: withRepositoryQueries(queries, GitBranchFooter),
		});
		sdk.extensions.implement(PaneKind, "changes", {
			component: withRepositoryQueries(queries, ChangesPane),
			icon: ChangesIcon,
		});
		sdk.extensions.implement(
			LauncherOption,
			"branch",
			withRepositoryQueries(queries, GitBranchSelector),
		);
		sdk.extensions.implement(KernelCommand, "open-changes", () => openChanges(sdk));
		sdk.extensions.implement(
			SessionDecoration,
			"pull-request",
			withRepositoryQueries(queries, GitSessionRowBadge),
		);
		sdk.extensions.implement(
			SessionDecoration,
			"branch",
			withRepositoryQueries(queries, GitSessionDetailsBranch),
		);
		sdk.extensions.implement(
			SessionDecoration,
			"pull-request-details",
			withRepositoryQueries(queries, GitSessionDetailsPullRequest),
		);
		sdk.extensions.implement(SessionFacet, "pull-request", createPullRequestFacet(sdk));

		const requests = new ActionRequests();
		sdk.extensions.implement(
			SessionAction,
			"repository-actions",
			withRepositoryQueries(
				queries,
				createGitSessionActions({ progress: new ActionProgress(), requests }),
			),
		);
		sdk.extensions.implement(KernelCommand, "commit", () => requestAction(requests, "commit"));
		sdk.extensions.implement(KernelCommand, "push", () => requestAction(requests, "push"));
		sdk.extensions.implement(KernelCommand, "create-pull-request", () =>
			requestAction(requests, "create-pr"),
		);
	},
});
