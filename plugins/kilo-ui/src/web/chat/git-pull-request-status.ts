import { useCallback, useSyncExternalStore } from "react";

import type { SDK } from "@kilo-desktop/feature-sdk";

import type { GitPullRequestStatusStoreValue } from "@kilo-desktop/plugin-git/contracts";

/**
 * Fully-qualified key of the git plugin's pull-request status state store.
 * Declared locally so kilo-ui carries no runtime dependency on the git
 * package (an optional peer) — pinned to git's contracts const by
 * git-pull-request-status.test.ts.
 */
export const GIT_PULL_REQUEST_STATUS_STORE_KEY = "git.pull-request-status";

/**
 * Pull requests keyed by session git status id, or `null` when the git
 * plugin is inactive (browser mode) and pull request status is unavailable.
 */
export function readGitPullRequestStatus(sdk: SDK): GitPullRequestStatusStoreValue | null {
	return sdk.state.get<GitPullRequestStatusStoreValue>(GIT_PULL_REQUEST_STATUS_STORE_KEY).peek();
}

export function useGitPullRequestStatus(sdk: SDK): GitPullRequestStatusStoreValue | null {
	const subscribe = useCallback(
		(onStoreChange: () => void) =>
			sdk.state
				.get<GitPullRequestStatusStoreValue>(GIT_PULL_REQUEST_STATUS_STORE_KEY)
				.subscribe(onStoreChange),
		[sdk],
	);
	const getSnapshot = useCallback(() => readGitPullRequestStatus(sdk), [sdk]);
	return useSyncExternalStore(subscribe, getSnapshot);
}
