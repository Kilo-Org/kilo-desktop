import { useCallback } from "react";

import { useDomainObjectState } from "@kilo-desktop/kernel/web";

import {
	EMPTY_WORK_SESSION_PANES,
	Panes,
	type PanesState,
	type WorkSessionPanes,
} from "../../contracts";

/** A work session's panes, as the panes domain object holds them. */
export function useWorkSessionPanes(workSessionId: string): WorkSessionPanes {
	const select = useCallback(
		(state: PanesState) => state.byWorkSession[workSessionId] ?? EMPTY_WORK_SESSION_PANES,
		[workSessionId],
	);
	return useDomainObjectState(Panes, select) ?? EMPTY_WORK_SESSION_PANES;
}
