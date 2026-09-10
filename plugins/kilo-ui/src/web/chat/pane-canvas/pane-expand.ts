import { useState } from "react";

import type { Arrangement } from "@anaconda-agentic-desktop/pane-layout";

export function canExpandPane(paneCount: number) {
	return paneCount > 1;
}

export function usePaneExpand(arrangement: Arrangement, paneCount: number, activeGroupId: string) {
	const canExpand = canExpandPane(paneCount);
	const [state, setState] = useState<{ arrangement: Arrangement; expanded: boolean }>({
		arrangement,
		expanded: false,
	});
	if (state.arrangement !== arrangement || (!canExpand && state.expanded)) {
		setState({ arrangement, expanded: false });
	}
	const expandedGroupId =
		state.arrangement === arrangement && canExpand && state.expanded ? activeGroupId || null : null;
	const isExpanded = expandedGroupId !== null;

	return {
		canExpand,
		expandedGroupId,
		isExpanded,
		setExpanded: (expanded: boolean) => setState({ arrangement, expanded }),
	};
}
