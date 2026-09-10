import {
	findPaneGroup,
	getPaneColumns,
	moveGroup,
	movePane,
	movePaneToGroup,
	type DropPosition,
	type PaneLayout,
} from "@anaconda-agentic-desktop/pane-layout";

export type PaneDrop = {
	kind: "pane" | "group";
	sourceId: string;
	targetKind: "tab" | "group";
	targetId: string;
	position: DropPosition;
};

export function applyPaneDrop(layout: PaneLayout, drop: PaneDrop): PaneLayout {
	if (drop.targetKind === "group") {
		return drop.kind === "group"
			? moveGroup(layout, drop.sourceId, drop.targetId, drop.position)
			: movePane(layout, drop.sourceId, drop.targetId, drop.position);
	}
	if (drop.kind !== "pane" || (drop.position !== "before" && drop.position !== "after"))
		return layout;
	const source = findPaneGroup(layout, drop.sourceId);
	const target = findPaneGroup(layout, drop.targetId);
	if (!source || !target) return layout;
	const sourceIndex = source.tabs.findIndex((pane) => pane.id === drop.sourceId);
	const targetIndex = target.tabs.findIndex((pane) => pane.id === drop.targetId);
	const insertion = targetIndex + (drop.position === "after" ? 1 : 0);
	const adjusted = source.id === target.id && sourceIndex < insertion ? insertion - 1 : insertion;
	return movePaneToGroup(layout, drop.sourceId, target.id, adjusted);
}

function panePlacement(layout: PaneLayout) {
	return getPaneColumns(layout.groups, layout.sizes).map((column) => ({
		pinned: column.pinned,
		groups: column.groups.map((group) => group.tabs.map((tab) => tab.id)),
	}));
}

export function changesPanePlacement(current: PaneLayout, next: PaneLayout): boolean {
	return JSON.stringify(panePlacement(current)) !== JSON.stringify(panePlacement(next));
}
