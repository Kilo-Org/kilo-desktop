import { useLayoutEffect, useRef } from "react";

import { useRightPanelStore } from "../right-panel/right-panel-store.js";
import { useLayoutPresets } from "./use-layout-presets.js";

/** When enabled, a draft gets one default decision after ChatPage clears the preceding chat.
 * A pending decision follows the local draft through send and remote promotion,
 * but not navigation to another thread. The store marker survives remounts;
 * the ref also remembers edits that removed the draft's store bucket.
 */
export function useDefaultLayout(
	sessionId: string,
	localDraftId: string | undefined,
	eligible: boolean,
	enabled: boolean,
	availableDefinitionIds: readonly string[],
) {
	const query = useLayoutPresets(enabled, false);
	const generation = useRef({ localDraftId, eligible, settled: !eligible });

	useLayoutEffect(() => {
		if (
			generation.current.localDraftId !== localDraftId ||
			(eligible && !generation.current.eligible)
		) {
			generation.current = { localDraftId, eligible, settled: !eligible };
		}
		generation.current.eligible = eligible;
		if (!enabled || !localDraftId || generation.current.settled) return;
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
	}, [
		availableDefinitionIds,
		eligible,
		enabled,
		localDraftId,
		query.data,
		query.isSuccess,
		sessionId,
	]);
}
