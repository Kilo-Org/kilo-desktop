import { useState } from "react";

import type { Arrangement } from "@anaconda-agentic-desktop/pane-layout";

export function canExpandPane(paneCount: number) {
	return paneCount > 1;
}

export function usePaneExpand(arrangement: Arrangement, paneCount: number) {
	const canExpand = canExpandPane(paneCount);
	const [state, setState] = useState<{ arrangement: Arrangement; groupId: string | null }>({
		arrangement,
		groupId: null,
	});
	if (state.arrangement !== arrangement || (!canExpand && state.groupId)) {
		setState({ arrangement, groupId: null });
	}
	const expandedGroupId = state.arrangement === arrangement && canExpand ? state.groupId : null;
	const isExpanded = expandedGroupId !== null && canExpand;

	return {
		canExpand,
		expandedGroupId,
		isExpanded,
		setExpandedGroupId: (groupId: string | null) => setState({ arrangement, groupId }),
	};
}
