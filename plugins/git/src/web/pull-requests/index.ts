import type { PluginSdk } from "@kilo-desktop/kernel";
import {
	WorkSessionDecoration,
	WorkSessionFacet,
} from "@kilo-desktop/plugin-work-sessions/contracts";

import type { GitWindow } from "../shared/git-window";
import { withRepositoryQueries } from "../shared/repository-queries";
import {
	GitSessionDetailsBranch,
	GitSessionDetailsPullRequest,
	GitSessionRowBadge,
} from "./GitSessionDetails";
import { createPullRequestFacet, reportShownDirectories } from "./window-sources";

/**
 * Work sessions' pull requests: the row badge, the hover card's branch and
 * pull request lines, the session list's "Pull requests" facet, and the
 * directory this window shows reported to `kilo.git/pull-requests`.
 */
export function activatePullRequests(sdk: PluginSdk, { queries }: GitWindow): void {
	reportShownDirectories(sdk, sdk.windowId ?? "main");
	sdk.extensions.implement(
		WorkSessionDecoration,
		"pull-request",
		withRepositoryQueries(queries, GitSessionRowBadge),
	);
	sdk.extensions.implement(
		WorkSessionDecoration,
		"branch",
		withRepositoryQueries(queries, GitSessionDetailsBranch),
	);
	sdk.extensions.implement(
		WorkSessionDecoration,
		"pull-request-details",
		withRepositoryQueries(queries, GitSessionDetailsPullRequest),
	);
	sdk.extensions.implement(WorkSessionFacet, "pull-request", createPullRequestFacet(sdk));
}
