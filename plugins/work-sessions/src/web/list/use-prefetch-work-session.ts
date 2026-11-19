import { useEffect, useRef } from "react";

import { useDomainObject, useExtensions } from "@kilo-desktop/kernel/web";
import { useStableCallback } from "@kilo-desktop/ui/hooks/use-stable";

import { PaneKind, Panes, WorkSessions } from "../../contracts";
import { implementationOf } from "../shared/pane-kinds";

/** How long the pointer rests on a row before its work session is loaded ahead. */
export const PREFETCH_HOVER_DELAY_MS = 100;

/**
 * Loads a work session's panes ahead once the pointer rests on its row: each
 * pane's kind (`pane-kind` `prefetch`) loads what the pane would load when
 * shown, so opening the session is instant. A pointer passing over rows on
 * its way elsewhere loads nothing.
 */
export function usePrefetchWorkSession() {
	const kinds = useExtensions(PaneKind);
	const panes = useDomainObject(Panes);
	const workSessions = useDomainObject(WorkSessions);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);

	const prefetch = (workSessionId: string) => {
		const workSession = workSessions
			?.getState()
			.workSessions.find((candidate) => candidate.id === workSessionId);
		const sessionPanes = panes?.getState().byWorkSession[workSessionId]?.panes ?? [];
		if (!workSession) return;
		for (const pane of sessionPanes) {
			const prefetchPane = implementationOf(kinds.find((kind) => kind.key === pane.kind))?.prefetch;
			try {
				prefetchPane?.({ workSession, pane, panes: sessionPanes });
			} catch {
				// Best effort: opening loads whatever a prefetch didn't.
			}
		}
	};

	// Stable: SessionList's row chrome is cached on these two.
	const intend = useStableCallback((workSessionId: string) => {
		clearTimeout(timer.current);
		timer.current = setTimeout(() => prefetch(workSessionId), PREFETCH_HOVER_DELAY_MS);
	});
	const cancel = useStableCallback(() => clearTimeout(timer.current));
	return { intend, cancel };
}
