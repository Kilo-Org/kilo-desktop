import { environmentReady, mainHost, type PluginSdk } from "@kilo-desktop/kernel";
import { Workspaces } from "@kilo-desktop/plugin-work-sessions/contracts";

import { Clone, GithubRepositories } from "../../contracts";
import { afterEnvironment, type GitClientSlice } from "../shared/git-client";
import { cloneWorkspace } from "./clone-workspace";
import { cloneGitUrl } from "./git-url-clone";
import { GithubRepositoryService, type PersistedRepositoryListing } from "./github-repositories";

export interface CloneAreaDeps {
	/** kilo.git's shared git client, for URL clones. */
	readonly client: Pick<GitClientSlice, "exec">;
}

/**
 * The clone area: `kilo.git/clone` (cloning a repository into a new
 * workspace) and `kilo.git/github-repositories` (the GitHub CLI user's
 * repositories, persisted under kv namespace `github-repositories` and
 * announced as `refreshed` after a background refresh). A GitHub source
 * clones with `gh`, a URL with git; kilo.work-sessions' workspaces are looked
 * up per call. Activation spawns nothing.
 */
export function activateClone(sdk: PluginSdk, deps: CloneAreaDeps): void {
	const ready = () => environmentReady(sdk);
	const client = afterEnvironment(deps.client, ready);
	const store = mainHost(sdk).storage.kv<PersistedRepositoryListing>({
		namespace: "github-repositories",
		defaults: { repositories: [], fetchedAt: 0 },
	});
	const github = new GithubRepositoryService({
		store,
		environmentReady: ready,
		onRefreshed: () => repositories.emit("refreshed", {}),
	});
	const repositories = sdk.domainObjects.provide(GithubRepositories, {
		initialState: {},
		methods: {
			list: ({ refresh }) => github.list(refresh === undefined ? {} : { refresh }),
			resolve: ({ repository }) => github.resolve(repository),
		},
	});
	sdk.domainObjects.provide(Clone, {
		initialState: {},
		methods: {
			cloneWorkspace: (input) =>
				cloneWorkspace(input, {
					workspaces: sdk.domainObjects.get(Workspaces)?.methods ?? null,
					clone: (source, destination) =>
						source.kind === "github"
							? github.clone({ repository: source.repository, destination })
							: cloneGitUrl(client, { url: source.url, destination }),
				}),
		},
	});
}
