import { dropPositionFromPoint, PANE_GAP, type DropPosition } from "@kilo-desktop/pane-layout";
import type { PaneDrop } from "./pane-drop";

const TAB_STRIP_SLOP = 6;
const TAB_SCROLL_EDGE = 28;
const CANVAS_TOP_DROP_SLOP = 56;
const OUTER_COLUMN_EDGE = 24;
const TARGET_SWITCH_DISTANCE = 12;

type DropTarget = { element: HTMLElement; rect: DOMRect; scrollX: number; scrollY: number };
export type DragPoint = { x: number; y: number };
export type PaneDragSource = {
	kind: PaneDrop["kind"];
	sourceId: string;
	source: HTMLElement;
	canvas: HTMLElement;
	targets: DropTarget[];
};
export type PaneDropTarget = {
	drop: PaneDrop;
	element: HTMLElement;
	space: number;
	neighbors: { element: HTMLElement; position: DropPosition; space: number }[];
	boundary: { space: number; gap: number } | undefined;
	stack: { top: number; height: number } | undefined;
	reorderSource: boolean;
};
export type ActivePaneDrop = {
	target: PaneDropTarget;
	preview: HTMLElement;
	lastPoint: DragPoint;
};
type ScrollTarget = { element: HTMLElement; direction: number } | undefined;
type DropResolution = { scroll: ScrollTarget } & (
	| { action: "clear" }
	| { action: "keep"; refreshPoint: boolean }
	| { action: "show"; target: PaneDropTarget }
);

function ancestorScroll(element: HTMLElement) {
	let scrollX = 0;
	let scrollY = 0;
	for (let parent = element.parentElement; parent; parent = parent.parentElement) {
		scrollX += parent.scrollLeft;
		scrollY += parent.scrollTop;
	}
	return { scrollX, scrollY };
}

function groupColumns(groups: DropTarget[]) {
	const columns = new Map<Element | null, DropTarget[]>();
	for (const group of groups) {
		const column = group.element.closest("[data-column-id]");
		const siblings = columns.get(column);
		if (siblings) siblings.push(group);
		else columns.set(column, [group]);
	}
	return (element: HTMLElement) => columns.get(element.closest("[data-column-id]")) ?? [];
}

function verticalBounds(groups: DropTarget[]) {
	return {
		top: Math.min(...groups.map((group) => group.rect.top)),
		bottom: Math.max(...groups.map((group) => group.rect.bottom)),
	};
}

function sharedEdgeTarget(
	target: DropTarget,
	position: DropPosition,
	groups: DropTarget[],
	y: number,
) {
	const previous = groups.find(({ element, rect }) => {
		if (element === target.element) return false;
		if (position === "before") {
			const gap = target.rect.left - rect.right;
			return gap >= -1 && gap <= PANE_GAP + 1 && y >= rect.top && y <= rect.bottom;
		}
		if (position === "above") {
			const gap = target.rect.top - rect.bottom;
			return (
				gap >= -1 &&
				gap <= PANE_GAP + 1 &&
				Math.abs(target.rect.left - rect.left) < 1 &&
				Math.abs(target.rect.right - rect.right) < 1
			);
		}
		return false;
	});
	return previous
		? {
				target: previous,
				position: position === "before" ? ("after" as const) : ("below" as const),
			}
		: { target, position };
}

export function capturePaneDragSource(
	kind: PaneDrop["kind"],
	sourceId: string,
	source: HTMLElement,
	canvas: HTMLElement,
): PaneDragSource {
	return {
		kind,
		sourceId,
		source,
		canvas,
		targets: [
			...canvas.querySelectorAll<HTMLElement>(
				"[data-pane-tab], [data-pane-group-id], [data-pane-group-tabs]",
			),
		]
			.filter((element) => element.getClientRects().length > 0)
			.map((element) => ({
				element,
				rect: element.getBoundingClientRect(),
				...ancestorScroll(element),
			})),
	};
}

// Read geometry without changing it: group bounds are captured before previews shrink
// their contents; live tab bounds follow insertion slots and strip scrolling.
export function resolvePaneDrop(
	drag: PaneDragSource,
	active: ActivePaneDrop | undefined,
	point: DragPoint,
	scrolling: boolean,
): DropResolution {
	let scroll: ScrollTarget;
	const canvasRect = drag.canvas.getBoundingClientRect();
	const aboveCanvas =
		point.y >= Math.max(0, canvasRect.top - CANVAS_TOP_DROP_SLOP) &&
		point.y < canvasRect.top &&
		point.x >= canvasRect.left &&
		point.x <= canvasRect.right;
	const onRightEdge =
		point.x >= canvasRect.right - OUTER_COLUMN_EDGE &&
		point.x <= canvasRect.right + PANE_GAP &&
		point.y >= canvasRect.top &&
		point.y <= canvasRect.bottom;
	const ownGroup = drag.source.closest("[data-pane-group-id]");
	const hit = document.elementFromPoint(point.x, point.y);
	if (!hit || (!drag.canvas.contains(hit) && !aboveCanvas && !onRightEdge)) {
		return { action: "clear", scroll };
	}
	const containsPoint = ({ rect }: DropTarget, tolerance = 0) =>
		point.x >= rect.left - tolerance &&
		point.x <= rect.right + tolerance &&
		point.y >= rect.top - tolerance &&
		point.y <= rect.bottom + tolerance;
	const targets = drag.targets
		.filter(({ element }) => element.isConnected)
		.map((target) => {
			const scroll = ancestorScroll(target.element);
			return {
				...target,
				rect: new DOMRect(
					target.rect.left + target.scrollX - scroll.scrollX,
					target.rect.top + target.scrollY - scroll.scrollY,
					target.rect.width,
					target.rect.height,
				),
			};
		});
	const groups = targets.filter((target) => Boolean(target.element.dataset.paneGroupId));
	const columnGroupsFor = groupColumns(groups);
	const rightmostGroup = groups
		.filter((target) => target.rect.left < canvasRect.right && target.rect.right > canvasRect.left)
		.reduce<DropTarget | undefined>(
			(rightmost, target) =>
				!rightmost || target.rect.right > rightmost.rect.right ? target : rightmost,
			undefined,
		);
	const onRightDrop =
		onRightEdge ||
		(drag.canvas.dataset.arrangement === "carousel" &&
			rightmostGroup &&
			point.x >= rightmostGroup.rect.right &&
			point.x <= canvasRect.right &&
			point.y >= canvasRect.top &&
			point.y <= canvasRect.bottom);
	const rightColumnGroups =
		onRightDrop && rightmostGroup ? columnGroupsFor(rightmostGroup.element) : [];
	const rightEdgeGroup =
		rightColumnGroups.find((target) => target.element !== ownGroup) ?? rightColumnGroups[0];
	const group =
		rightEdgeGroup ??
		groups.find(
			(target) =>
				target.element.dataset.paneGroupId &&
				(containsPoint(target) ||
					(aboveCanvas &&
						target.rect.top <= canvasRect.top + 1 &&
						point.x >= target.rect.left &&
						point.x <= target.rect.right)),
		) ??
		groups.find((target) => containsPoint(target, PANE_GAP));
	const groupStrip = targets.find(
		(target) => target.element.dataset.paneGroupTabs === group?.element.dataset.paneGroupId,
	);
	const splitAbove =
		aboveCanvas ||
		Boolean(groupStrip && group && point.y >= group.rect.top && point.y < groupStrip.rect.top);
	const liveStrip = groupStrip?.element.getBoundingClientRect();
	const strip =
		groupStrip &&
		liveStrip &&
		!splitAbove &&
		((point.y >= groupStrip.rect.top && point.y <= groupStrip.rect.bottom + TAB_STRIP_SLOP) ||
			(point.x >= liveStrip.left &&
				point.x <= liveStrip.right &&
				point.y >= liveStrip.top &&
				point.y <= liveStrip.bottom + TAB_STRIP_SLOP));
	if (drag.kind === "pane" && strip && groupStrip && liveStrip && !onRightDrop) {
		const direction =
			point.x < liveStrip.left + TAB_SCROLL_EDGE
				? -1
				: point.x > liveStrip.right - TAB_SCROLL_EDGE
					? 1
					: 0;
		if (direction) scroll = { element: groupStrip.element, direction };
	}
	const groupPosition = group
		? dropPositionFromPoint("group", point.x, point.y, group.rect)
		: undefined;
	const enteringGroup =
		drag.kind === "pane" &&
		(strip || groupPosition === "above") &&
		!splitAbove &&
		(active?.target.drop.position === "above" || active?.target.drop.position === "below");
	const previewBounds = active?.target.element.dataset.paneTab
		? active.target.element.closest<HTMLElement>("[data-pane-group-tabs]")?.getBoundingClientRect()
		: active?.target.drop.position !== "inside"
			? active?.target.boundary || active?.target.stack
				? drag.canvas.getBoundingClientRect()
				: active?.target.element.getBoundingClientRect()
			: undefined;
	const previewRect = active?.preview.getBoundingClientRect();
	if (
		!enteringGroup &&
		!splitAbove &&
		!onRightDrop &&
		previewRect &&
		previewBounds &&
		point.x >= Math.max(previewBounds.left, previewRect.left - TAB_STRIP_SLOP) &&
		point.x <= Math.min(previewBounds.right, previewRect.right + TAB_STRIP_SLOP) &&
		point.y >= Math.max(previewBounds.top, previewRect.top - TAB_STRIP_SLOP) &&
		point.y <= Math.min(previewBounds.bottom, previewRect.bottom + TAB_STRIP_SLOP)
	) {
		return { action: "keep", refreshPoint: true, scroll };
	}

	const stripTabs =
		drag.kind === "pane" && strip && !splitAbove && !onRightDrop
			? targets
					.filter(
						(target) =>
							target.element.dataset.paneTab &&
							target.element !== drag.source &&
							target.element.closest("[data-pane-group-id]") === group?.element,
					)
					.map((target) => ({ ...target, rect: target.element.getBoundingClientRect() }))
			: [];
	const nextTab = stripTabs.find((target) => point.x < target.rect.left + target.rect.width / 2);
	const tab = nextTab ?? stripTabs.at(-1);
	const target = tab ?? group;
	if (!target) {
		return { action: "clear", scroll };
	}
	let { element, rect } = target;
	let position: DropPosition = onRightDrop
		? "after"
		: splitAbove
			? "above"
			: tab
				? nextTab
					? "before"
					: "after"
				: groupPosition === "above"
					? "inside"
					: groupPosition!;
	if (!tab) {
		const boundary = sharedEdgeTarget(target, position, groups, point.y);
		({ element, rect } = boundary.target);
		position = boundary.position;
	}
	const columnGroups =
		!tab && (position === "before" || position === "after") ? columnGroupsFor(element) : [];
	if (columnGroups.length > 1) {
		const anchor =
			columnGroups.find((candidate) => candidate.element !== ownGroup) ?? columnGroups[0]!;
		({ element, rect } = anchor);
	}
	const bounds = verticalBounds(columnGroups);
	const neighbor =
		!tab && position === "after"
			? groups.find((candidate) => {
					const gap = candidate.rect.left - rect.right;
					if (gap < -1 || gap > PANE_GAP + 1) return false;
					const adjacent = verticalBounds(columnGroupsFor(candidate.element));
					return (
						Math.abs(adjacent.top - bounds.top) < 1 && Math.abs(adjacent.bottom - bounds.bottom) < 1
					);
				})
			: undefined;
	const neighborColumnGroups = neighbor ? columnGroupsFor(neighbor.element) : [];
	const fullHeightColumn = columnGroups.length > 1 || neighborColumnGroups.length > 1;
	if (
		active?.target.element === element &&
		active.target.drop.position === position &&
		Boolean(active.target.stack) === fullHeightColumn
	) {
		return { action: "keep", refreshPoint: true, scroll };
	}
	if (
		!enteringGroup &&
		!splitAbove &&
		!onRightDrop &&
		!scrolling &&
		active &&
		Math.hypot(point.x - active.lastPoint.x, point.y - active.lastPoint.y) < TARGET_SWITCH_DISTANCE
	)
		return { action: "keep", refreshPoint: false, scroll };
	const noOp =
		element === drag.source ||
		(element === ownGroup &&
			(position === "inside" || ownGroup.querySelectorAll("[data-pane-tab]").length === 1));
	const drop: PaneDrop = {
		kind: drag.kind,
		sourceId: drag.sourceId,
		targetKind: element.dataset.paneTab ? "tab" : "group",
		targetId: element.dataset.paneTab ?? element.dataset.paneGroupId!,
		position,
	};
	if (noOp) {
		return { action: "clear", scroll };
	}
	const isTab = drop.targetKind === "tab";
	const sourceWidth = () =>
		// The source is a visible tab in the canvas, so capturePaneDragSource always collected it.
		// react-doctor-disable-next-line react-doctor/no-non-null-assertion-on-maybe-undefined-result
		drag.targets.find((target) => target.element === drag.source)!.rect.width;
	const space = isTab
		? Math.min(160, sourceWidth())
		: neighbor
			? rect.width / 3
			: (position === "above" || position === "below" ? rect.height : rect.width) / 2;
	const neighbors: PaneDropTarget["neighbors"] = [];
	if (fullHeightColumn) {
		for (const sibling of columnGroups) {
			if (sibling.element !== element)
				neighbors.push({ element: sibling.element, position, space });
		}
	}
	if (neighbor) {
		for (const sibling of fullHeightColumn ? neighborColumnGroups : [neighbor]) {
			neighbors.push({
				element: sibling.element,
				position: "before",
				space: neighbor.rect.width / 3,
			});
		}
	}
	return {
		action: "show",
		scroll,
		target: {
			drop,
			element,
			space,
			neighbors,
			boundary: neighbor
				? { space: neighbor.rect.width / 3, gap: neighbor.rect.left - rect.right }
				: undefined,
			stack: fullHeightColumn
				? { top: bounds.top - rect.top, height: bounds.bottom - bounds.top }
				: undefined,
			reorderSource: isTab && group?.element === ownGroup,
		},
	};
}
