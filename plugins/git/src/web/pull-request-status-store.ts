import type { SDK, StoreHandle } from "@kilo-desktop/feature-sdk";

import {
	GIT_PULL_REQUEST_STATUS_STORE_KEY,
	PULL_REQUEST_STATUS_STORE_NAME,
	type GitPullRequestStatusStoreValue,
} from "../contracts/schemas.js";
import { type PersistedGitPrSnapshot, useGitPrStatusStore } from "./git-pr-status-store.js";

/**
 * The git pull-request status store: a read-only projection of the PR
 * status snapshots (`useGitPrStatusStore`) into the git-owned
 * `pull-request-status` state store, so other plugins (kilo-ui's session
 * list filter) can see which PR status targets have a pull request without
 * importing git's module-level zustand store.
 *
 * Ownership and invariants:
 * - `webRegister` registers the store once per SDK, seeded from the cached
 *   snapshots so consumers see known pull requests at boot. Registration is
 *   idempotent per SDK through a `WeakMap`, because only
 *   `sdk.state.register` returns a writable handle.
 * - `GitPrStatusProvider` owns the live sync for its lifetime. It writes only
 *   when the projection changes (which targets have a pull request, or its
 *   state), so polling that finds the same pull requests, or only a new PR
 *   number or draft flag, does not re-render consumers.
 * - Only targets with a pull request get an entry. Consumers cannot tell
 *   "no PR" from "not looked up yet", and do not need to.
 * - The projection deliberately skips `selectPullRequest`'s "branch awaiting
 *   lookup" rule, which needs the header's cached `git status`. Right after a
 *   branch switch on the open chat's checkout, the published PR can lag the
 *   row badge until the header-triggered lookup lands.
 */
const handlesBySdk = new WeakMap<SDK, StoreHandle<GitPullRequestStatusStoreValue>>();

export function projectPullRequestStatus(
	snapshots: Readonly<Record<string, PersistedGitPrSnapshot>>,
): GitPullRequestStatusStoreValue {
	const value: GitPullRequestStatusStoreValue = {};
	for (const [id, entry] of Object.entries(snapshots)) {
		const pullRequest = entry.snapshot.pullRequest;
		if (!pullRequest) continue;
		value[id] = { state: pullRequest.state };
	}
	return value;
}

function samePullRequestStatus(
	left: GitPullRequestStatusStoreValue,
	right: GitPullRequestStatusStoreValue,
): boolean {
	const leftIds = Object.keys(left);
	if (leftIds.length !== Object.keys(right).length) return false;
	return leftIds.every((id) => right[id] !== undefined && right[id].state === left[id]?.state);
}

/** Register the store for this SDK (first handle wins) and return its handle. */
export function registerPullRequestStatusStore(
	sdk: SDK,
): StoreHandle<GitPullRequestStatusStoreValue> {
	let handle = handlesBySdk.get(sdk);
	if (handle === undefined) {
		handle = sdk.state.register(
			PULL_REQUEST_STATUS_STORE_NAME,
			projectPullRequestStatus(useGitPrStatusStore.getState().snapshots),
		);
		handlesBySdk.set(sdk, handle);
	}
	return handle;
}

/** Mirror snapshot changes into the store until the returned cleanup runs. */
export function syncPullRequestStatusStore(sdk: SDK): () => void {
	const handle = registerPullRequestStatusStore(sdk);
	const store = sdk.state.get<GitPullRequestStatusStoreValue>(GIT_PULL_REQUEST_STATUS_STORE_KEY);
	const publish = (snapshots: Readonly<Record<string, PersistedGitPrSnapshot>>) => {
		const value = projectPullRequestStatus(snapshots);
		const current = store.peek();
		if (current && samePullRequestStatus(current, value)) return;
		handle.set(value);
	};
	publish(useGitPrStatusStore.getState().snapshots);
	return useGitPrStatusStore.subscribe((next, previous) => {
		if (next.snapshots !== previous.snapshots) publish(next.snapshots);
	});
}
