import { createContext, type FC, useContext, useState, type ReactNode } from "react";

import { useRevertBoundaryId } from "./checkpoint-revert";

type RevertPendingValue = {
	pendingId: string | null;
	setPendingId: (id: string | null) => void;
};

/**
 * In-flight revert feedback, scoped per Thread. A module-global store would
 * leak across chat panes (pane-canvas mounts several Threads), and the aui
 * store cannot carry the boundary message id (`thread.isRunning` does not
 * identify which message was clicked), so this React context is the channel.
 * `pendingId` is the id of the message whose Revert-to-here click is awaiting
 * the server: the clicked button renders a spinner, and messages strictly
 * after it dim until the revert lands.
 *
 * Concurrency invariant: `pendingId` can only be set by `RevertToHereButton`.
 * While it is set, `thread.isRunning` is true — the patched controller
 * dispatches `run.reverting` for both `revert` and `unrevert`, and
 * `isOpenCodeStateRunning` includes `"reverting"` — which disables the
 * row-restore buttons, the Revert-to-here button itself, and the undo
 * control.  No other flow can therefore move the boundary while a
 * click-initiated revert is in flight.
 *
 * Clearing channel: `pendingId` is cleared either here (when `boundaryId`
 * matches the clicked message) or in the click handler on HTTP error or
 * boundary mismatch. The patched controller throws when the REST response
 * carries no data, so a resolved `extras.revert()` guarantees that the
 * `session.updated` dispatch already happened synchronously — the boundary
 * lands before this provider re-renders and clears `pendingId` in the same
 * microtask batch. SSE delivery of `session.updated` may still arrive first
 * on a fast server and is also handled correctly.
 */
const RevertPendingContext = createContext<RevertPendingValue | null>(null);

const NO_PENDING: RevertPendingValue = { pendingId: null, setPendingId: () => undefined };

export const RevertPendingProvider: FC<{ children: ReactNode }> = ({ children }) => {
	const [pendingId, setPendingId] = useState<string | null>(null);
	const boundaryId = useRevertBoundaryId();
	if (pendingId !== null && boundaryId === pendingId) {
		// The revert landed: the pending boundary now matches the clicked
		// message. `session.updated` may arrive before or after the HTTP
		// promise resolves, and clearing here covers both orderings — so the
		// click handler must NOT clear on success (no un-dim flash, no stale
		// dim after a later Restore all). Self-extinguishing: pendingId
		// becomes null, so this cannot loop.
		setPendingId(null);
	}
	const value = { pendingId, setPendingId };
	return <RevertPendingContext.Provider value={value}>{children}</RevertPendingContext.Provider>;
};

/** Null-safe fallback so components render in isolation without the provider. */
export const useRevertPending = (): RevertPendingValue =>
	useContext(RevertPendingContext) ?? NO_PENDING;
