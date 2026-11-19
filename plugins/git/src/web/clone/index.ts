import type { PluginSdk } from "@kilo-desktop/kernel";
import { WorkspaceSource } from "@kilo-desktop/plugin-work-sessions/contracts";

import { GithubRepositories, Repository } from "../../contracts";
import type { GitWindow } from "../shared/git-window";
import { withRepositoryQueries } from "../shared/repository-queries";
import { gitUrlSource } from "./GitUrlSource";
import { prefetchGithubRepositories } from "./github-queries";
import { githubRepositorySource } from "./GithubRepositorySource";

/**
 * Starting a workspace from a clone: the GitHub repository and Git URL
 * sources of kilo.work-sessions' New workspace dialog. Both name and place
 * the new folder with the dialog's own form and clone through
 * `Clone.cloneWorkspace`. Opening the dialog warms the GitHub list into
 * this window's cache, once the GitHub CLI is signed in.
 */
export function activateClone(sdk: PluginSdk, { queries }: GitWindow): void {
	sdk.extensions.implement(WorkspaceSource, "github-repository", {
		icon: githubRepositorySource.icon,
		Component: withRepositoryQueries(queries, githubRepositorySource.Component),
		prepare: () =>
			void prefetchGithubRepositories(
				queries,
				sdk.domainObjects.get(Repository),
				sdk.domainObjects.get(GithubRepositories),
			),
	});
	sdk.extensions.implement(WorkspaceSource, "git-url", gitUrlSource);
}
