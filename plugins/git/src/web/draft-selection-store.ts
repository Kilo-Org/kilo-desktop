import type { SDK, StoreHandle } from "@kilo-desktop/feature-sdk";

import {
	DRAFT_SELECTION_STORE_NAME,
	GIT_DRAFT_SELECTION_STORE_KEY,
	type GitDraftSelectionStoreValue,
	type GitDraftWorktreeSelection,
} from "../contracts/schemas.js";

/**
 * The git draft-selection store: one workspace's choice of where the next
 * chat session runs (the local checkout or a fresh worktree), keyed by
 * workspace id in the git-owned `draft-worktree-selection` state store.
 *
 * Ownership and invariants:
 * - Registration is a boot-time concern owned by the plugin's web entry:
 *   `webRegister` calls `registerDraftSelectionStore` exactly once per SDK,
 *   before any zone component can mount. `setSelection` therefore assumes
 *   the store is registered and throws an invariant error otherwise — a
 *   silent lazy re-register would hide a broken boot (the failure mode this
 *   split exists to surface).
 * - The handle registry is a `WeakMap` because only `sdk.state.register`
 *   returns a writable handle (`get()` is read-only), while every SDK
 *   instance — including one created fresh per test — needs its own. The
 *   map also keeps `registerDraftSelectionStore` idempotent per SDK, so a
 *   double boot cannot trigger the broker's double-register warning.
 * - Readers (`peekSelection`, the `useDraftSelection` hook) deliberately
 *   bypass the registry and use lazy `sdk.state.get`: before registration
 *   the broker's placeholder emits `null`, which every consumer already
 *   treats as "run in the local checkout" — the safe direction.
 */
const handlesBySdk = new WeakMap<SDK, StoreHandle<GitDraftSelectionStoreValue>>();

/**
 * Register the selection store for this SDK and return its writable
 * handle. Called once from the plugin's `webRegister` boot hook; safe to
 * call again on the same SDK (the first handle wins).
 */
export function registerDraftSelectionStore(sdk: SDK): StoreHandle<GitDraftSelectionStoreValue> {
	let handle = handlesBySdk.get(sdk);
	if (handle === undefined) {
		handle = sdk.state.register(DRAFT_SELECTION_STORE_NAME, {});
		handlesBySdk.set(sdk, handle);
	}
	return handle;
}

/** The stored selection for a workspace, or `null` when none was written. */
export function peekSelection(sdk: SDK, workspaceId: string): GitDraftWorktreeSelection | null {
	const value = sdk.state.get<GitDraftSelectionStoreValue>(GIT_DRAFT_SELECTION_STORE_KEY).peek();
	return value?.[workspaceId] ?? null;
}

/** Write one workspace's selection, preserving the other entries. */
export function setSelection(
	sdk: SDK,
	workspaceId: string,
	selection: GitDraftWorktreeSelection,
): void {
	const handle = handlesBySdk.get(sdk);
	if (handle === undefined) {
		throw new Error(
			"The git draft-selection store is not registered — webRegister(sdk) must run before setSelection.",
		);
	}
	const current =
		sdk.state.get<GitDraftSelectionStoreValue>(GIT_DRAFT_SELECTION_STORE_KEY).peek() ?? {};
	handle.set({ ...current, [workspaceId]: selection });
}
