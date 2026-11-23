export const ARRANGEMENTS = ["tiles", "carousel"] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

export const PANE_KINDS = ["agent", "document", "notebook", "tool"] as const;
export type PaneKind = (typeof PANE_KINDS)[number];

export const DROP_POSITIONS = ["before", "after", "above", "below", "inside"] as const;
export type DropPosition = (typeof DROP_POSITIONS)[number];
export type EdgeDropPosition = Exclude<DropPosition, "inside">;

export const AGENT_PANE_PREFERRED_WIDTH = 480;
export const ARTIFACT_PANE_PREFERRED_WIDTH = 360;
export const PANE_MIN_WIDTH = 240;
export const PANE_GAP = 4;
export const STACK_PANE_MIN_HEIGHT = 120;

const STACK_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,160}$/;

export type PaneDescriptor = {
	id: string;
	kind: PaneKind;
	title: string;
};

export type PaneGroup = {
	id: string;
	tabs: PaneDescriptor[];
	activePaneId: string;
	preferredWidth: number;
	minWidth: number;
	pinned: boolean;
	stackId?: string;
	stackWeight?: number;
};

export type PaneLayout = {
	groups: PaneGroup[];
	activePaneId: string;
	sizes: Record<string, number>;
};

export type PaneColumn = {
	id: string;
	groups: PaneGroup[];
	width: number;
	minWidth: number;
	pinned: boolean;
};

export type ProjectedPane = PaneDescriptor & {
	groupId: string;
	width: number;
	heightWeight: number;
};

export type ProjectedGroup = PaneGroup & {
	pane: PaneDescriptor;
	width: number;
	heightWeight: number;
};

export type ProjectedColumn = {
	id: string;
	groups: ProjectedGroup[];
	width: number;
	minWidth: number;
	pinned: boolean;
};

export type LayoutProjection = {
	visible: ProjectedPane[];
	groups: ProjectedGroup[];
	columns: ProjectedColumn[];
	overflowIds: string[];
};

export type GroupRect = {
	id: string;
	x: number;
	width: number;
	right: number;
};

function isPaneKind(value: unknown): value is PaneKind {
	return typeof value === "string" && (PANE_KINDS as readonly string[]).includes(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function validStackWeight(group: PaneGroup): number | undefined {
	return isFiniteNumber(group.stackWeight) && group.stackWeight > 0 && group.stackWeight <= 1
		? group.stackWeight
		: undefined;
}

function stackTotal(groups: readonly PaneGroup[]): number {
	const total = groups.reduce((sum, group) => sum + (validStackWeight(group) ?? 1), 0);
	return groups.every((group) => validStackWeight(group) !== undefined) &&
		Math.abs(total - 1) <= Number.EPSILON * groups.length
		? 1
		: total;
}

function clearStack(group: PaneGroup): PaneGroup {
	if (group.stackId === undefined && group.stackWeight === undefined) return group;
	const next = { ...group };
	delete next.stackId;
	delete next.stackWeight;
	return next;
}

function groupWidth(group: PaneGroup, sizes: Readonly<Record<string, number>>): number {
	return Math.max(group.minWidth, sizes[group.id] ?? group.preferredWidth);
}

function createUniqueId(ids: ReadonlySet<string>, base: string): string {
	if (!ids.has(base)) return base;
	let instance = 2;
	while (ids.has(`${base}-${instance}`)) instance += 1;
	return `${base}-${instance}`;
}

function singletonGroup(
	pane: PaneDescriptor,
	ids: ReadonlySet<string>,
	options?: Partial<Pick<PaneGroup, "preferredWidth" | "minWidth" | "pinned">>,
): PaneGroup {
	return {
		id: createUniqueId(ids, `group:${pane.id}`),
		tabs: [pane],
		activePaneId: pane.id,
		preferredWidth: options?.preferredWidth ?? preferredWidthForKind(pane.kind),
		minWidth: options?.minWidth ?? PANE_MIN_WIDTH,
		pinned: options?.pinned ?? false,
	};
}

function normalizeGroups(
	groups: readonly PaneGroup[],
	sizes: Readonly<Record<string, number>> = {},
): PaneGroup[] {
	return getPaneColumns(groups, sizes).flatMap((column) => {
		if (column.groups.length === 1 || !column.groups[0]?.stackId) {
			const group = clearStack(column.groups[0]!);
			return [group.pinned === column.pinned ? group : { ...group, pinned: column.pinned }];
		}
		const pinnedGroups = column.groups.map((group) =>
			group.pinned === column.pinned ? group : { ...group, pinned: column.pinned },
		);
		if (!column.groups.some((group) => validStackWeight(group) !== undefined)) {
			return pinnedGroups;
		}
		const total = stackTotal(pinnedGroups);
		return pinnedGroups.map((group) => ({
			...group,
			stackWeight: (validStackWeight(group) ?? 1) / total,
		}));
	});
}

function compactPinnedColumns(
	groups: readonly PaneGroup[],
	sizes: Readonly<Record<string, number>> = {},
): PaneGroup[] {
	const columns = getPaneColumns(groups, sizes);
	return [
		...columns.filter((column) => column.pinned).flatMap((column) => column.groups),
		...columns.filter((column) => !column.pinned).flatMap((column) => column.groups),
	];
}

function resolveGroup(layout: PaneLayout, id: string): PaneGroup | undefined {
	return findGroup(layout, id) ?? findPaneGroup(layout, id);
}

function columnContaining(layout: PaneLayout, id: string): PaneColumn | undefined {
	const group = resolveGroup(layout, id);
	if (!group) return undefined;
	return getPaneColumns(layout.groups, layout.sizes).find((column) =>
		column.groups.some((entry) => entry.id === group.id),
	);
}

function stackIdFor(layout: PaneLayout, target: PaneGroup): string {
	const ids = new Set(layout.groups.flatMap((group) => (group.stackId ? [group.stackId] : [])));
	return createUniqueId(ids, `stack:${target.id}`.slice(0, 160));
}

function activeTab(group: PaneGroup): PaneDescriptor {
	return group.tabs.find((pane) => pane.id === group.activePaneId) ?? group.tabs[0]!;
}

function withGroups(
	layout: PaneLayout,
	groups: readonly PaneGroup[],
	sizes: Record<string, number> = layout.sizes,
): PaneLayout {
	return {
		...layout,
		groups: compactPinnedColumns(normalizeGroups(groups, sizes), sizes),
		sizes,
	};
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function flattenPanes(input: PaneLayout | readonly PaneGroup[]): PaneDescriptor[] {
	const groups = "groups" in input ? input.groups : input;
	return groups.flatMap((group) => group.tabs);
}

export function findPane(layout: PaneLayout, paneId: string): PaneDescriptor | undefined {
	return flattenPanes(layout).find((pane) => pane.id === paneId);
}

export function findGroup(layout: PaneLayout, groupId: string): PaneGroup | undefined {
	return layout.groups.find((group) => group.id === groupId);
}

export function findPaneGroup(layout: PaneLayout, paneId: string): PaneGroup | undefined {
	return layout.groups.find((group) => group.tabs.some((pane) => pane.id === paneId));
}

export function getPaneColumns(
	groups: readonly PaneGroup[],
	sizes: Readonly<Record<string, number>> = {},
): PaneColumn[] {
	const columns: PaneColumn[] = [];
	for (const group of groups) {
		const previous = columns.at(-1);
		if (group.stackId && previous?.groups[0]?.stackId === group.stackId) {
			previous.groups.push(group);
			previous.width = Math.max(previous.width, groupWidth(group, sizes));
			previous.minWidth = Math.max(previous.minWidth, group.minWidth);
			previous.pinned ||= group.pinned;
			continue;
		}
		columns.push({
			id: group.stackId ?? group.id,
			groups: [group],
			width: groupWidth(group, sizes),
			minWidth: group.minWidth,
			pinned: group.pinned,
		});
	}
	return columns;
}

export function calculateStackResize({
	columnHeight,
	paneCount,
	upperHeight,
	lowerHeight,
	deltaY,
	gap = PANE_GAP,
}: {
	columnHeight: number;
	paneCount: number;
	upperHeight: number;
	lowerHeight: number;
	deltaY: number;
	gap?: number;
}): { upperHeight: number; lowerHeight: number; minimumHeight: number } {
	const upperStart = Number.isFinite(upperHeight) ? Math.max(0, upperHeight) : 0;
	const lowerStart = Number.isFinite(lowerHeight) ? Math.max(0, lowerHeight) : 0;
	const pairHeight = upperStart + lowerStart;
	if (!Number.isFinite(pairHeight)) {
		return { upperHeight: 0, lowerHeight: 0, minimumHeight: 0 };
	}

	const validPaneCount = Number.isSafeInteger(paneCount) && paneCount > 0 ? paneCount : 0;
	const validGap = Number.isFinite(gap) ? Math.max(0, gap) : PANE_GAP;
	const usableHeight =
		validPaneCount > 0 && Number.isFinite(columnHeight)
			? Math.max(0, columnHeight - (validPaneCount - 1) * validGap)
			: 0;
	const minimumHeight =
		validPaneCount > 0
			? Math.min(STACK_PANE_MIN_HEIGHT, usableHeight / validPaneCount, pairHeight / 2)
			: 0;
	const upper = clamp(
		upperStart + (Number.isFinite(deltaY) ? deltaY : 0),
		minimumHeight,
		pairHeight - minimumHeight,
	);

	return { upperHeight: upper, lowerHeight: pairHeight - upper, minimumHeight };
}

export function calculateGroupRects(
	layout: PaneLayout,
	leadingInset: number,
	gap = PANE_GAP,
	widths?: ReadonlyMap<string, number>,
): GroupRect[] {
	let cursor = leadingInset;
	const rects: GroupRect[] = [];
	for (const column of getPaneColumns(layout.groups, layout.sizes)) {
		const width = widths?.get(column.id) ?? widths?.get(column.groups[0]!.id) ?? column.width;
		for (const group of column.groups) {
			rects.push({ id: group.id, x: cursor, width, right: cursor + width });
		}
		cursor += width + gap;
	}
	return rects;
}

export function getScrollTarget({
	group,
	scrollLeft,
	viewportWidth,
	occludedLeft,
	edgePadding = 4,
}: {
	group: GroupRect;
	scrollLeft: number;
	viewportWidth: number;
	occludedLeft: number;
	edgePadding?: number;
}): number {
	const visibleLeft = scrollLeft + occludedLeft + edgePadding;
	const visibleRight = scrollLeft + viewportWidth - edgePadding;
	if (group.right > visibleRight) {
		return Math.max(0, group.right - viewportWidth + edgePadding);
	}
	if (group.x < visibleLeft) {
		return Math.max(0, group.x - occludedLeft - edgePadding);
	}
	return scrollLeft;
}

export function dropPositionFromPoint(
	targetType: "pane" | "group" | "tab",
	clientX: number,
	clientY: number,
	rect: { left: number; top: number; width: number; height: number },
): DropPosition {
	if (targetType === "tab") {
		return clientX < rect.left + rect.width / 2 ? "before" : "after";
	}

	const edgeWidth = Math.min(92, Math.max(40, rect.width * 0.22));
	const edgeHeight = Math.min(92, Math.max(40, rect.height * 0.22));
	if (clientX < rect.left + edgeWidth) return "before";
	if (clientX > rect.left + rect.width - edgeWidth) return "after";
	if (clientY < rect.top + edgeHeight) return "above";
	if (clientY > rect.top + rect.height - edgeHeight) return "below";
	return "inside";
}

export function createLayout(panes: readonly PaneDescriptor[], activePaneId?: string): PaneLayout {
	const ids = new Set<string>();
	const groups = panes.map((pane) => {
		const group = singletonGroup({ ...pane }, ids);
		ids.add(group.id);
		return group;
	});
	const active = panes.find((pane) => pane.id === activePaneId)?.id ?? panes[0]?.id ?? "";
	return { groups, activePaneId: active, sizes: {} };
}

export function setActivePane(layout: PaneLayout, paneId: string): PaneLayout {
	const group = findPaneGroup(layout, paneId);
	if (!group) return layout;
	const groups =
		group.activePaneId === paneId
			? layout.groups
			: layout.groups.map((entry) =>
					entry.id === group.id ? { ...entry, activePaneId: paneId } : entry,
				);
	if (groups === layout.groups && layout.activePaneId === paneId) return layout;
	return { ...layout, groups, activePaneId: paneId };
}

export function addPane(
	layout: PaneLayout,
	pane: PaneDescriptor,
	options?: {
		readonly index?: number;
		readonly preferredWidth?: number;
	},
): PaneLayout {
	const existing = findPaneGroup(layout, pane.id);
	if (existing) {
		const groups = layout.groups.map((group) =>
			group.id === existing.id
				? {
						...group,
						tabs: group.tabs.map((entry) => (entry.id === pane.id ? { ...pane } : entry)),
						activePaneId: pane.id,
					}
				: group,
		);
		return { ...layout, groups, activePaneId: pane.id };
	}

	const ids = new Set(layout.groups.map((group) => group.id));
	const group = singletonGroup({ ...pane }, ids, options);
	const groups = [...layout.groups];
	const index =
		options?.index === undefined
			? groups.length
			: Math.max(0, Math.min(options.index, groups.length));
	groups.splice(index, 0, group);
	return {
		...layout,
		groups: compactPinnedColumns(groups, layout.sizes),
		activePaneId: pane.id,
	};
}

export function removePane(layout: PaneLayout, paneId: string): PaneLayout {
	const groupIndex = layout.groups.findIndex((group) =>
		group.tabs.some((pane) => pane.id === paneId),
	);
	if (groupIndex < 0) return layout;
	const source = layout.groups[groupIndex]!;
	const paneIndex = source.tabs.findIndex((pane) => pane.id === paneId);
	const tabs = source.tabs.filter((pane) => pane.id !== paneId);
	const local = tabs[Math.min(paneIndex, tabs.length - 1)]?.id ?? tabs[0]?.id ?? "";
	const groups = tabs.length
		? layout.groups.map((group, index) =>
				index === groupIndex
					? {
							...group,
							tabs,
							activePaneId: source.activePaneId === paneId ? local : source.activePaneId,
						}
					: group,
			)
		: layout.groups.filter((_, index) => index !== groupIndex);
	const sizes = { ...layout.sizes };
	if (tabs.length === 0) delete sizes[source.id];
	const next = withGroups(layout, groups, sizes);
	if (layout.activePaneId !== paneId) return next;

	const nearby =
		next.groups.find((group) => group.id === source.id)?.activePaneId ||
		next.groups[Math.min(groupIndex, next.groups.length - 1)]?.activePaneId ||
		next.groups.at(-1)?.activePaneId ||
		"";
	return { ...next, activePaneId: nearby };
}

export function movePaneToGroup(
	layout: PaneLayout,
	paneId: string,
	targetGroupId: string,
	index?: number,
): PaneLayout {
	const source = findPaneGroup(layout, paneId);
	const target = resolveGroup(layout, targetGroupId);
	if (!source || !target) return layout;
	const pane = source.tabs.find((entry) => entry.id === paneId)!;

	if (source.id === target.id) {
		if (index === undefined) return setActivePane(layout, paneId);
		const tabs = source.tabs.filter((entry) => entry.id !== paneId);
		const insertion = clamp(index ?? tabs.length, 0, tabs.length);
		tabs.splice(insertion, 0, pane);
		if (tabs.every((entry, tabIndex) => entry === source.tabs[tabIndex])) return layout;
		return {
			...layout,
			groups: layout.groups.map((group) =>
				group.id === source.id ? { ...group, tabs, activePaneId: paneId } : group,
			),
			activePaneId: paneId,
		};
	}

	const sourceIndex = source.tabs.findIndex((entry) => entry.id === paneId);
	const sourceTabs = source.tabs.filter((entry) => entry.id !== paneId);
	const sourceActive =
		source.activePaneId === paneId
			? (sourceTabs[Math.min(sourceIndex, sourceTabs.length - 1)]?.id ?? sourceTabs[0]?.id ?? "")
			: source.activePaneId;
	const targetTabs = [...target.tabs];
	const insertion = clamp(index ?? targetTabs.length, 0, targetTabs.length);
	targetTabs.splice(insertion, 0, pane);

	const groups = layout.groups.flatMap((group) => {
		if (group.id === source.id) {
			return sourceTabs.length ? [{ ...group, tabs: sourceTabs, activePaneId: sourceActive }] : [];
		}
		if (group.id === target.id) {
			return [{ ...group, tabs: targetTabs, activePaneId: paneId }];
		}
		return [group];
	});
	const sizes = { ...layout.sizes };
	if (sourceTabs.length === 0) delete sizes[source.id];
	return { ...withGroups(layout, groups, sizes), activePaneId: paneId };
}

function moveGroupToEdge(
	layout: PaneLayout,
	sourceId: string,
	targetId: string,
	position: EdgeDropPosition,
): PaneLayout {
	const source = findGroup(layout, sourceId);
	const target = findGroup(layout, targetId);
	if (!source || !target || source.id === target.id) return layout;

	if (position === "before" || position === "after") {
		const remaining = normalizeGroups(
			layout.groups.filter((group) => group.id !== source.id),
			layout.sizes,
		);
		const column = getPaneColumns(remaining, layout.sizes).find((entry) =>
			entry.groups.some((group) => group.id === target.id),
		);
		if (!column) return layout;
		const boundary = position === "before" ? column.groups[0]! : column.groups.at(-1)!;
		const index =
			remaining.findIndex((group) => group.id === boundary.id) + (position === "after" ? 1 : 0);
		remaining.splice(index, 0, clearStack(source));
		return withGroups(layout, remaining);
	}

	const sameStack = source.stackId && source.stackId === target.stackId;
	if (sameStack) {
		const groups = layout.groups.filter((group) => group.id !== source.id);
		const index =
			groups.findIndex((group) => group.id === target.id) + (position === "below" ? 1 : 0);
		groups.splice(index, 0, source);
		return withGroups(layout, groups);
	}

	let groups = normalizeGroups(
		layout.groups.filter((group) => group.id !== source.id),
		layout.sizes,
	);
	const nextTarget = groups.find((group) => group.id === target.id);
	if (!nextTarget) return layout;
	const column = getPaneColumns(groups, layout.sizes).find((entry) =>
		entry.groups.some((group) => group.id === target.id),
	);
	if (!column) return layout;
	const stackId = nextTarget.stackId ?? stackIdFor(layout, nextTarget);
	const total = stackTotal(column.groups);
	let insertedWeight = 0;
	groups = groups.map((group) => {
		if (!column.groups.some((member) => member.id === group.id)) return group;
		const weight = (validStackWeight(group) ?? 1) / total;
		if (group.id === target.id) {
			insertedWeight = weight / 2;
			return { ...group, stackId, stackWeight: insertedWeight };
		}
		return { ...group, stackId, stackWeight: weight };
	});
	const index =
		groups.findIndex((group) => group.id === target.id) + (position === "below" ? 1 : 0);
	groups.splice(index, 0, {
		...clearStack(source),
		stackId,
		stackWeight: insertedWeight,
		pinned: nextTarget.pinned,
	});
	return withGroups(layout, groups);
}

export function moveGroup(
	layout: PaneLayout,
	sourceGroupId: string,
	targetGroupId: string,
	position: DropPosition,
): PaneLayout {
	const source = resolveGroup(layout, sourceGroupId);
	const target = resolveGroup(layout, targetGroupId);
	if (!source || !target || source.id === target.id) return layout;
	if (position !== "inside") {
		return setActivePane(
			moveGroupToEdge(layout, source.id, target.id, position),
			source.activePaneId,
		);
	}

	const tabs = [...target.tabs, ...source.tabs];
	const groups = layout.groups
		.filter((group) => group.id !== source.id)
		.map((group) =>
			group.id === target.id ? { ...group, tabs, activePaneId: source.activePaneId } : group,
		);
	const sizes = { ...layout.sizes };
	delete sizes[source.id];
	return {
		...withGroups(layout, groups, sizes),
		activePaneId: source.activePaneId,
	};
}

export function movePane(
	layout: PaneLayout,
	paneId: string,
	targetGroupId: string,
	position: DropPosition,
): PaneLayout {
	const source = findPaneGroup(layout, paneId);
	const target = resolveGroup(layout, targetGroupId);
	if (!source || !target) return layout;
	if (position === "inside") {
		return movePaneToGroup(layout, paneId, target.id);
	}
	if (source.tabs.length === 1) {
		return {
			...moveGroupToEdge(layout, source.id, target.id, position),
			activePaneId: paneId,
		};
	}

	const pane = source.tabs.find((entry) => entry.id === paneId)!;
	const paneIndex = source.tabs.findIndex((entry) => entry.id === paneId);
	const tabs = source.tabs.filter((entry) => entry.id !== paneId);
	const activePaneId =
		source.activePaneId === paneId
			? (tabs[Math.min(paneIndex, tabs.length - 1)]?.id ?? tabs[0]!.id)
			: source.activePaneId;
	const ids = new Set(layout.groups.map((group) => group.id));
	const singleton = singletonGroup(pane, ids, {
		...source,
		preferredWidth: groupWidth(source, layout.sizes),
	});
	const sourceIndex = layout.groups.findIndex((group) => group.id === source.id);
	const groups = layout.groups.map((group) =>
		group.id === source.id ? { ...group, tabs, activePaneId } : group,
	);
	groups.splice(sourceIndex + 1, 0, singleton);
	const extracted = { ...layout, groups };
	return {
		...moveGroupToEdge(extracted, singleton.id, target.id, position),
		activePaneId: paneId,
	};
}

export type PaneDirection = "up" | "down" | "left" | "right";

const SPLIT_POSITION: Record<PaneDirection, EdgeDropPosition> = {
	up: "above",
	down: "below",
	left: "before",
	right: "after",
};

/**
 * Where moving a tab one step in `direction` takes it (`movePane`'s target),
 * as VS Code's "Move Editor into Left/Right/Above/Below Group": into the
 * neighbouring group that way — the next column, at the same height in its
 * stack, or the next group in its own stack — else split into a new group at
 * that edge. Null when the move would change nothing.
 */
export function paneDirectionTarget(
	layout: PaneLayout,
	paneId: string,
	direction: PaneDirection,
): { targetGroupId: string; position: DropPosition } | null {
	const source = findPaneGroup(layout, paneId);
	if (!source) return null;
	const columns = getPaneColumns(layout.groups, layout.sizes);
	const columnIndex = columns.findIndex((column) =>
		column.groups.some((group) => group.id === source.id),
	);
	const column = columns[columnIndex]!;
	const stackIndex = column.groups.findIndex((group) => group.id === source.id);
	const horizontal = direction === "left" || direction === "right";
	const step = direction === "left" || direction === "up" ? -1 : 1;

	const neighbour = horizontal
		? columns[columnIndex + step]?.groups.at(
				Math.min(stackIndex, (columns[columnIndex + step]?.groups.length ?? 1) - 1),
			)
		: column.groups[stackIndex + step];
	if (neighbour) return { targetGroupId: neighbour.id, position: "inside" };

	const position = SPLIT_POSITION[direction];
	if (source.tabs.length > 1) return { targetGroupId: source.id, position };
	// A lone tab is its group: it can only leave its stack for a new column,
	// placed beside the column (a group of it other than its own).
	const sibling = horizontal ? column.groups.find((group) => group.id !== source.id) : undefined;
	return sibling ? { targetGroupId: sibling.id, position } : null;
}

export function togglePin(layout: PaneLayout, id: string): PaneLayout {
	const group = resolveGroup(layout, id);
	if (!group) return layout;
	const column = columnContaining(layout, group.id);
	if (!column) return layout;
	const ids = new Set(column.groups.map((entry) => entry.id));
	const pinned = !group.pinned;
	const groups = layout.groups.map((entry) => (ids.has(entry.id) ? { ...entry, pinned } : entry));
	return { ...layout, groups: compactPinnedColumns(groups, layout.sizes) };
}

export function resizeColumn(layout: PaneLayout, id: string, width: number): PaneLayout {
	const column = columnContaining(layout, id);
	if (!column || !Number.isFinite(width)) return layout;
	const next = Math.max(column.minWidth, width);
	const sizes = { ...layout.sizes };
	for (const group of column.groups) sizes[group.id] = next;
	return { ...layout, sizes };
}

export function resizeStackDivider(
	layout: PaneLayout,
	upperGroupId: string,
	lowerGroupId: string,
	upperShare: number,
): PaneLayout {
	if (!Number.isFinite(upperShare) || upperShare <= 0 || upperShare >= 1) return layout;
	const upper = resolveGroup(layout, upperGroupId);
	const lower = resolveGroup(layout, lowerGroupId);
	if (!upper?.stackId || upper.stackId !== lower?.stackId) return layout;
	const upperIndex = layout.groups.findIndex((group) => group.id === upper.id);
	if (upperIndex < 0 || layout.groups[upperIndex + 1]?.id !== lower.id) return layout;
	const column = columnContaining(layout, upper.id);
	if (!column || !column.groups.some((group) => group.id === lower.id)) return layout;

	const total = stackTotal(column.groups);
	const pair = (validStackWeight(upper) ?? 1) / total + (validStackWeight(lower) ?? 1) / total;
	const upperWeight = pair * upperShare;
	const lowerWeight = pair - upperWeight;
	const groups = layout.groups.map((group) => {
		if (!column.groups.some((entry) => entry.id === group.id)) return group;
		if (group.id === upper.id) return { ...group, stackWeight: upperWeight };
		if (group.id === lower.id) return { ...group, stackWeight: lowerWeight };
		return { ...group, stackWeight: (validStackWeight(group) ?? 1) / total };
	});
	return { ...layout, groups };
}

function fittedWidths(
	columns: readonly PaneColumn[],
	width: number,
	gap: number,
): Map<string, number> {
	const content = Math.max(0, width - Math.max(0, columns.length - 1) * gap);
	const total = columns.reduce((sum, column) => sum + column.width, 0);
	const widths = new Map<string, number>();
	let remainingWidth = content;
	let remainingWeight = total;
	for (let index = 0; index < columns.length; index += 1) {
		const column = columns[index]!;
		const fitted =
			index === columns.length - 1 || remainingWeight <= 0
				? remainingWidth
				: Math.floor((remainingWidth * column.width) / remainingWeight);
		widths.set(column.id, fitted);
		remainingWidth -= fitted;
		remainingWeight -= column.width;
	}
	return widths;
}

function projectColumn(column: PaneColumn, width: number): ProjectedColumn {
	const total = stackTotal(column.groups);
	const groups = column.groups.map((group) => {
		const pane = activeTab(group);
		return {
			...group,
			pane,
			width,
			heightWeight: (validStackWeight(group) ?? 1) / total,
		};
	});
	return { ...column, groups, width };
}

export function projectLayout(
	layout: PaneLayout,
	arrangement: Arrangement,
	viewportWidth: number,
): LayoutProjection {
	const columns = getPaneColumns(layout.groups, layout.sizes);
	if (columns.length === 0) {
		return { visible: [], groups: [], columns: [], overflowIds: [] };
	}

	let widths: Map<string, number>;
	switch (arrangement) {
		case "tiles":
			widths = fittedWidths(columns, Math.max(0, viewportWidth), PANE_GAP);
			break;
		case "carousel":
			widths = new Map(columns.map((column) => [column.id, column.width]));
			break;
		default: {
			const exhaustive: never = arrangement;
			return exhaustive;
		}
	}

	const projectedColumns = columns.map((column) =>
		projectColumn(column, widths.get(column.id) ?? column.width),
	);
	const groups = projectedColumns.flatMap((column) => column.groups);
	const visible = groups.map((group): ProjectedPane => ({
		...group.pane,
		groupId: group.id,
		width: group.width,
		heightWeight: group.heightWeight,
	}));
	return { visible, groups, columns: projectedColumns, overflowIds: [] };
}

function parseDescriptor(value: unknown): PaneDescriptor | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || record.id.length === 0) return null;
	if (!isPaneKind(record.kind) || typeof record.title !== "string") return null;
	return { id: record.id, kind: record.kind, title: record.title };
}

function parseGroup(value: unknown): PaneGroup | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string" || record.id.length === 0) return null;
	if (!Array.isArray(record.tabs) || record.tabs.length === 0) return null;
	const tabs = record.tabs.map(parseDescriptor);
	if (tabs.some((pane) => pane === null)) return null;
	const descriptors = tabs as PaneDescriptor[];
	if (
		typeof record.activePaneId !== "string" ||
		!descriptors.some((pane) => pane.id === record.activePaneId)
	) {
		return null;
	}
	if (
		!isFiniteNumber(record.preferredWidth) ||
		record.preferredWidth <= 0 ||
		!isFiniteNumber(record.minWidth) ||
		record.minWidth <= 0 ||
		typeof record.pinned !== "boolean"
	) {
		return null;
	}
	const group: PaneGroup = {
		id: record.id,
		tabs: descriptors,
		activePaneId: record.activePaneId,
		preferredWidth: record.preferredWidth,
		minWidth: record.minWidth,
		pinned: record.pinned,
	};
	if (typeof record.stackId === "string" && STACK_ID_PATTERN.test(record.stackId)) {
		group.stackId = record.stackId;
	}
	if (isFiniteNumber(record.stackWeight) && record.stackWeight > 0 && record.stackWeight <= 1) {
		group.stackWeight = record.stackWeight;
	}
	return group;
}

export function serializeLayout(layout: PaneLayout): string {
	return JSON.stringify(layout);
}

export function parseLayoutJson(value: unknown): PaneLayout | null {
	const parsed =
		typeof value === "string"
			? (() => {
					try {
						return JSON.parse(value) as unknown;
					} catch {
						return null;
					}
				})()
			: value;
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
	const record = parsed as Record<string, unknown>;
	if (!Array.isArray(record.groups) || "panes" in record) return null;
	const groups = record.groups.map(parseGroup);
	if (groups.some((group) => group === null)) return null;
	const list = groups as PaneGroup[];
	const groupIds = list.map((group) => group.id);
	const paneIds = list.flatMap((group) => group.tabs.map((pane) => pane.id));
	if (new Set(groupIds).size !== groupIds.length || new Set(paneIds).size !== paneIds.length) {
		return null;
	}
	if (typeof record.activePaneId !== "string" || !paneIds.includes(record.activePaneId)) {
		if (paneIds.length > 0) return null;
		if (record.activePaneId !== "") return null;
	}

	const sizes: Record<string, number> = {};
	if (record.sizes && typeof record.sizes === "object" && !Array.isArray(record.sizes)) {
		const knownGroupIds = new Set(groupIds);
		for (const [id, width] of Object.entries(record.sizes as Record<string, unknown>)) {
			if (knownGroupIds.has(id) && isFiniteNumber(width)) sizes[id] = width;
		}
	}
	return {
		groups: compactPinnedColumns(normalizeGroups(list, sizes), sizes),
		activePaneId: record.activePaneId,
		sizes,
	};
}

export function preferredWidthForKind(kind: PaneKind): number {
	switch (kind) {
		case "agent":
			return AGENT_PANE_PREFERRED_WIDTH;
		case "document":
		case "notebook":
		case "tool":
			return ARTIFACT_PANE_PREFERRED_WIDTH;
		default: {
			const exhaustive: never = kind;
			return exhaustive;
		}
	}
}

export function descriptor(input: { id: string; kind: PaneKind; title: string }): PaneDescriptor {
	return { ...input };
}
