import { environmentReady, mainHost, type PluginSdk } from "@kilo-desktop/kernel";
import { Workspaces, type Workspace } from "@kilo-desktop/plugin-work-sessions/contracts";

import { GithubRepositories } from "../../contracts";
import { cloneWorkspace, type CloneWorkspaceInput } from "./clone-workspace";
import { GithubRepositoryService, type PersistedRepositoryListing } from "./github-repositories";

export interface CloneAreaDeps {
	/** `git clone`s any remote URL into `destination` (the repository area's git client). */
	readonly cloneGitUrl: (url: string, destination: string) => Promise<void>;
}

export interface CloneArea {
	/** `kilo.git/repository`'s `cloneWorkspace`. */
	readonly cloneWorkspace: (input: CloneWorkspaceInput) => Promise<Workspace>;
}

/**
 * The clone area: `kilo.git/github-repositories` (the GitHub CLI user's
 * repositories, persisted under kv namespace `github-repositories` and
 * announced as `refreshed` after a background refresh) and the
 * `cloneWorkspace` the repository area binds into `kilo.git/repository`.
 * A GitHub source clones with `gh`, a URL with git; kilo.work-sessions'
 * workspaces are looked up per call. Activation spawns nothing.
 */
export function activateClone(sdk: PluginSdk, deps: CloneAreaDeps): CloneArea {
	const store = mainHost(sdk).storage.kv<PersistedRepositoryListing>({
		namespace: "github-repositories",
		defaults: { repositories: [], fetchedAt: 0 },
	});
	const github = new GithubRepositoryService({
		store,
		environmentReady: () => environmentReady(sdk),
		onRefreshed: () => provider.emit("refreshed", {}),
	});
	const provider = sdk.domainObjects.provide(GithubRepositories, {
		initialState: {},
		methods: {
			list: ({ refresh }) => github.list(refresh === undefined ? {} : { refresh }),
			resolve: ({ repository }) => github.resolve(repository),
		},
	});

	return {
		cloneWorkspace: (input) =>
			cloneWorkspace(input, {
				workspaces: sdk.domainObjects.get(Workspaces)?.methods ?? null,
				clone: (source, destination) =>
					source.kind === "github"
						? github.clone({ repository: source.repository, destination })
						: deps.cloneGitUrl(source.url, destination),
			}),
	};
}
