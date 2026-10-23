import { useLayoutEffect, useRef } from "react";

import { useRightPanelStore } from "../right-panel/right-panel-store.js";
import { useLayoutPresets } from "./use-layout-presets.js";

/** When enabled, a draft session gets one default layout decision.
 * A pending decision follows the session through its first send, but not
 * navigation to another session. The store marker survives remounts; the ref
 * also remembers edits that removed the session's store bucket.
 */
export function useDefaultLayout(
	sessionId: string,
	eligible: boolean,
	enabled: boolean,
	availableDefinitionIds: readonly string[],
) {
	const query = useLayoutPresets(enabled, false);
	const generation = useRef({ sessionId, eligible, settled: !eligible });

	useLayoutEffect(() => {
		if (generation.current.sessionId !== sessionId || (eligible && !generation.current.eligible)) {
			generation.current = { sessionId, eligible, settled: !eligible };
		}
		generation.current.eligible = eligible;
		if (!enabled || generation.current.settled) return;
		const store = useRightPanelStore.getState();
		if (store.bySessionId[sessionId]) {
			generation.current.settled = true;
			return;
		}
		if (!query.isSuccess) {
			return useRightPanelStore.subscribe((next, previous) => {
				if (next.bySessionId[sessionId] !== previous.bySessionId[sessionId]) {
					generation.current.settled = true;
				}
			});
		}
		generation.current.settled = true;
		const preset = query.data.presets.find((entry) => entry.id === query.data.defaultPresetId);
		store.initializeDefaultLayout(sessionId, preset?.template, availableDefinitionIds);
	}, [availableDefinitionIds, eligible, enabled, query.data, query.isSuccess, sessionId]);
}
