import { useCallback, useSyncExternalStore } from "react";

import type { SDK } from "@kilo-desktop/feature-sdk";

import {
	GIT_DRAFT_SELECTION_STORE_KEY,
	type GitDraftSelectionStoreValue,
	type GitDraftWorktreeSelection,
} from "../contracts/schemas.js";

/**
 * The workspace's draft git selection, or `null` while no entry exists
 * (unscoped chat, or a send racing the menu's first default write —
 * consumers treat `null` as local). The snapshot is the stored entry
 * object itself, so it is reference-stable across unrelated updates and
 * `useSyncExternalStore` only re-renders when this workspace's entry
 * actually changes.
 */
export function useDraftSelection(
	sdk: SDK,
	workspaceId: string | undefined,
): GitDraftWorktreeSelection | null {
	const subscribe = useCallback(
		(onStoreChange: () => void) => {
			if (workspaceId === undefined) return () => {};
			const store = sdk.state.get<GitDraftSelectionStoreValue>(GIT_DRAFT_SELECTION_STORE_KEY);
			return store.subscribe(onStoreChange);
		},
		[sdk, workspaceId],
	);

	const getSnapshot = useCallback((): GitDraftWorktreeSelection | null => {
		if (workspaceId === undefined) return null;
		const value = sdk.state.get<GitDraftSelectionStoreValue>(GIT_DRAFT_SELECTION_STORE_KEY).peek();
		return value?.[workspaceId] ?? null;
	}, [sdk, workspaceId]);

	return useSyncExternalStore(subscribe, getSnapshot);
}
