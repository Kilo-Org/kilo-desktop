import { useCallback, useMemo, useSyncExternalStore } from "react";

import { useExtensions } from "@kilo-desktop/kernel/web";

import { WorkSessionFacet, type WorkSessionPullRequestState } from "../../contracts";
import type { SessionListPullRequests } from "./session-list-view";

const NOTHING: Readonly<Record<string, WorkSessionPullRequestState>> = {};
const NO_SOURCE = { get: () => NOTHING, subscribe: () => () => undefined };

/**
 * Each session's pull request from the first `pull-request` session facet;
 * null without one, which hides the session list's pull request filter.
 */
export function usePullRequestFacet(): SessionListPullRequests | null {
	const source = useExtensions(WorkSessionFacet).find(
		(contribution) => contribution.metadata.facet === "pull-request",
	)?.implementation;
	const active = source ?? NO_SOURCE;
	const subscribe = useCallback((listener: () => void) => active.subscribe(listener), [active]);
	const states: Readonly<Record<string, WorkSessionPullRequestState>> = useSyncExternalStore(
		subscribe,
		active.get,
	);
	return useMemo(() => {
		if (!source) return null;
		return Object.fromEntries(Object.entries(states).map(([id, state]) => [id, { state }]));
	}, [source, states]);
}
