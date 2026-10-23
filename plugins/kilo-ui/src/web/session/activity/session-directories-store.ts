import type { SDK, StoreHandle } from "@kilo-desktop/feature-sdk";

import type { SessionActivity } from "./session-activity-logic.js";
import type { SessionActivityStore } from "./session-activity-store.js";

/**
 * Session-directories store: an inversion of the usual ownership
 * direction. Git needs to know which sessions use a worktree directory
 * and on which branch (to warn before switching a shared worktree's
 * branch), but the dependency direction is kilo-ui → git, so git cannot
 * import kilo-ui's contracts. git's contracts therefore declare this
 * store's name/key/shape, and kilo-ui — the actual owner of session
 * data — registers and writes it under its own feature namespace. The
 * name is redeclared locally here (not imported from
 * `@kilo-desktop/plugin-git/contracts`) so this module carries no
 * runtime dependency on the git package;
 * `session-directories-store.test.ts` pins the redeclared name against
 * git's contracts const.
 */
export const SESSION_DIRECTORIES_STORE_NAME = "session-directories";

export type SessionDirectoriesStoreValue = Record<string, Record<string, number>>;

/**
 * Derive directory → stamped branch → session count (any status) from the
 * activity map. Sessions without a directory are skipped; sessions with a
 * directory but no `worktreeBranch` are skipped too — they cannot be
 * branch-matched, and the git-side confirm reads a specific branch's
 * bucket, not a directory total. Pure.
 */
export function countSessionDirectories(
	sessions: Readonly<Record<string, SessionActivity>>,
): SessionDirectoriesStoreValue {
	const counts: SessionDirectoriesStoreValue = {};
	for (const session of Object.values(sessions)) {
		if (session.directory === undefined || session.worktreeBranch === undefined) continue;
		const byBranch = (counts[session.directory] ??= {});
		byBranch[session.worktreeBranch] = (byBranch[session.worktreeBranch] ?? 0) + 1;
	}
	return counts;
}

function countsEqual(a: SessionDirectoriesStoreValue, b: SessionDirectoriesStoreValue): boolean {
	const aKeys = Object.keys(a);
	if (aKeys.length !== Object.keys(b).length) return false;
	return aKeys.every((key) => {
		const aInner = a[key];
		const bInner = b[key];
		if (aInner === undefined || bInner === undefined) return false;
		const aInnerKeys = Object.keys(aInner);
		if (aInnerKeys.length !== Object.keys(bInner).length) return false;
		return aInnerKeys.every((branch) => aInner[branch] === bInner[branch]);
	});
}

/**
 * Idempotency guard, mirroring `draft-selection-store.ts`: only
 * `sdk.state.register` returns a writable handle, and registering the
 * same store name twice on the same SDK logs a broker warning — the
 * `WeakMap` keeps repeated `bindSessionDirectoriesStore` calls (e.g. an
 * effect re-running) from double-registering.
 */
const handlesBySdk = new WeakMap<SDK, StoreHandle<SessionDirectoriesStoreValue>>();

/**
 * Register the store on this SDK (idempotent) and keep it seeded from
 * `sessionActivity`'s vanilla zustand subscription. Writes only when the
 * derived map actually changes, so git readers never see churn from
 * unrelated status updates. Returns the unsubscribe function.
 */
export function bindSessionDirectoriesStore(
	sdk: SDK,
	sessionActivity: SessionActivityStore,
): () => void {
	let handle = handlesBySdk.get(sdk);
	if (handle === undefined) {
		handle = sdk.state.register<SessionDirectoriesStoreValue>(SESSION_DIRECTORIES_STORE_NAME, {});
		handlesBySdk.set(sdk, handle);
	}
	const key = `${sdk.featureId}.${SESSION_DIRECTORIES_STORE_NAME}`;
	const write = () => {
		const next = countSessionDirectories(sessionActivity.getState().sessions);
		const current = sdk.state.get<SessionDirectoriesStoreValue>(key).peek() ?? {};
		if (!countsEqual(current, next)) handle!.set(next);
	};
	write();
	return sessionActivity.subscribe(write);
}
