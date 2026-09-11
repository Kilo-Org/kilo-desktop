import { ExternalLinkIcon, Minimize2Icon } from "lucide-react";
import {
	Fragment,
	useCallback,
	useEffect,
	useLayoutEffect,
	useReducer,
	useRef,
	useState,
	type FC,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";

import {
	calculateGroupRects,
	calculateStackResize,
	findGroup,
	findPaneGroup,
	flattenPanes,
	getPaneColumns,
	getScrollTarget,
	PANE_GAP,
	projectLayout,
	resizeColumn,
	resizeStackDivider,
	setActivePane,
	togglePin,
	type Arrangement,
	type PaneLayout,
	type ProjectedColumn,
	type ProjectedGroup,
} from "@anaconda-agentic-desktop/pane-layout";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { ResizableHandle } from "@anaconda-agentic-desktop/ui/components/resizable";
import { Tabs, TabsContent } from "@anaconda-agentic-desktop/ui/components/tabs";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import type { RightPanelTabDefinition } from "../right-panel/right-panel-tab-registry.js";
import { applyPaneDrop, changesPanePlacement, type PaneDrop } from "./pane-drop.js";
import { PaneAddTab } from "./PaneAddTab.js";
import { PaneColumnMount } from "./PaneColumnMount.js";
import { PaneTabStrip } from "./PaneTabStrip.js";
import {
	applyCarouselScroll,
	bindCarouselWheel,
	shouldStartCarouselPan,
} from "./carousel-gestures.js";
import { ChatPaneHost } from "./ChatPaneHost.js";
import {
	createPaneContentMountRegistry,
	PaneContentMount,
	PaneContentTarget,
	type PaneContentMountRegistry,
} from "./PaneContentMount.js";
import type { PaneIconOverride } from "./pane-kind-icon.js";
import { usePaneExpand } from "./pane-expand.js";
import { usePaneFrameFocus } from "./use-pane-frame-focus.js";

const FALLBACK_VIEWPORT_WIDTH = 960;
const PANE_REVEAL_SPRING = {
	stiffness: 180,
	damping: 24,
	restDistance: 0.4,
	restSpeed: 8,
} as const;

type ScrollMotion = {
	frame: number;
	target: number;
	velocity: number;
	lastTime: number;
};

function createScrollMotion(): ScrollMotion {
	return { frame: 0, target: 0, velocity: 0, lastTime: 0 };
}

function cancelHorizontalScroll(motionRef: { current: ScrollMotion }) {
	const motion = motionRef.current;
	if (motion.frame) cancelAnimationFrame(motion.frame);
	motion.frame = 0;
	motion.velocity = 0;
	motion.lastTime = 0;
}

const PoppedOutPanePlaceholder: FC<{
	paneId: string;
	onFocus?: (paneId: string) => void;
	onDock?: (paneId: string) => void;
}> = ({ paneId, onFocus, onDock }) => (
	<div
		className="text-muted-foreground flex min-h-0 flex-1 flex-col items-center justify-center gap-4 p-6 text-center"
		data-qa-id={`chat-pane-popped-out-${paneId}`}
	>
		<p className="text-sm">This view is open in a separate window.</p>
		<div className="flex flex-wrap items-center justify-center gap-2">
			{onFocus ? (
				<Button type="button" variant="outline" size="sm" onClick={() => onFocus(paneId)}>
					<ExternalLinkIcon />
					Bring to front
				</Button>
			) : null}
			{onDock ? (
				<Button type="button" variant="outline" size="sm" onClick={() => onDock(paneId)}>
					<Minimize2Icon />
					Dock
				</Button>
			) : null}
		</div>
	</div>
);

function animateHorizontalScroll(
	element: HTMLElement,
	target: number,
	motionRef: { current: ScrollMotion },
) {
	const motion = motionRef.current;
	if (motion.frame) cancelAnimationFrame(motion.frame);
	const clampedTarget = Math.max(0, Math.min(target, element.scrollWidth - element.clientWidth));
	const distance = clampedTarget - element.scrollLeft;
	const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	if (reducedMotion || Math.abs(distance) < PANE_REVEAL_SPRING.restDistance) {
		applyCarouselScroll(element, clampedTarget);
		motion.frame = 0;
		motion.target = clampedTarget;
		motion.velocity = 0;
		motion.lastTime = 0;
		return;
	}

	if (motion.velocity && Math.sign(motion.velocity) !== Math.sign(distance)) motion.velocity *= 0.2;
	motion.target = clampedTarget;
	motion.lastTime = performance.now();
	applyCarouselScroll(element, element.scrollLeft);

	const step = (now: number) => {
		const deltaSeconds = Math.min(0.032, Math.max(0.001, (now - motion.lastTime) / 1000));
		motion.lastTime = now;
		const current = element.scrollLeft;
		const displacement = motion.target - current;
		const acceleration =
			PANE_REVEAL_SPRING.stiffness * displacement - PANE_REVEAL_SPRING.damping * motion.velocity;
		motion.velocity += acceleration * deltaSeconds;
		const next = current + motion.velocity * deltaSeconds;
		const crossedTarget = Math.sign(motion.target - next) !== Math.sign(displacement);
		const atScrollBoundary =
			(motion.target === 0 || motion.target === element.scrollWidth - element.clientWidth) &&
			crossedTarget;

		element.scrollLeft = atScrollBoundary ? motion.target : next;

		if (
			atScrollBoundary ||
			(Math.abs(displacement) < PANE_REVEAL_SPRING.restDistance &&
				Math.abs(motion.velocity) < PANE_REVEAL_SPRING.restSpeed)
		) {
			element.scrollLeft = motion.target;
			motion.frame = 0;
			motion.velocity = 0;
			motion.lastTime = 0;
			return;
		}

		motion.frame = requestAnimationFrame(step);
	};

	motion.frame = requestAnimationFrame(step);
}

function carouselResize(layout: PaneLayout, column: ProjectedColumn, delta: number): PaneLayout {
	const group = column.groups[0];
	if (!group) return layout;
	return resizeColumn(layout, group.id, column.width + delta);
}

function tileResize(
	layout: PaneLayout,
	column: ProjectedColumn,
	adjacent: ProjectedColumn | undefined,
	delta: number,
): PaneLayout {
	const group = column.groups[0];
	const neighbor = adjacent?.groups[0];
	if (!group || !neighbor || !adjacent) return layout;
	const groupWeight = layout.sizes[group.id] ?? group.preferredWidth;
	const neighborWeight = layout.sizes[neighbor.id] ?? neighbor.preferredWidth;
	const displayedWidth = column.width + adjacent.width;
	if (displayedWidth <= 0) return layout;
	const scaledDelta = (delta * (groupWeight + neighborWeight)) / displayedWidth;
	const clamped = Math.min(
		neighborWeight - neighbor.minWidth,
		Math.max(group.minWidth - groupWeight, scaledDelta),
	);
	return resizeColumn(
		resizeColumn(layout, group.id, groupWeight + clamped),
		neighbor.id,
		neighborWeight - clamped,
	);
}

function withoutPoppedOutPanes(
	layout: PaneLayout,
	poppedOutPaneIds?: ReadonlySet<string>,
): PaneLayout {
	if (!poppedOutPaneIds?.size) return layout;
	const groups = layout.groups.flatMap((group) => {
		const tabs = group.tabs.filter((pane) => !poppedOutPaneIds.has(pane.id));
		if (tabs.length === 0) {
			const pane =
				group.tabs.find((candidate) => candidate.id === group.activePaneId) ?? group.tabs[0];
			return pane ? [{ ...group, tabs: [pane], activePaneId: pane.id }] : [];
		}
		return [
			{
				...group,
				tabs,
				activePaneId: tabs.some((pane) => pane.id === group.activePaneId)
					? group.activePaneId
					: tabs[0]!.id,
			},
		];
	});
	const activePaneId = poppedOutPaneIds.has(layout.activePaneId)
		? (groups.flatMap((group) => group.tabs).find((pane) => !poppedOutPaneIds.has(pane.id))?.id ??
			groups[0]?.activePaneId ??
			"")
		: layout.activePaneId;
	return { ...layout, groups, activePaneId };
}

function paneMountLocations(layout: PaneLayout): ReadonlyMap<string, string> {
	const locations = new Map<string, string>();
	for (const column of getPaneColumns(layout.groups, layout.sizes)) {
		for (const [groupIndex, group] of column.groups.entries()) {
			for (const [tabIndex, pane] of group.tabs.entries()) {
				locations.set(pane.id, `${column.id}/${groupIndex}/${group.id}/${tabIndex}`);
			}
		}
	}
	return locations;
}

const StackResizeHandle: FC<{
	upperGroup: ProjectedGroup;
	lowerGroup: ProjectedGroup;
	groupCount: number;
	onCommit: (upperShare: number) => void;
}> = ({ upperGroup, lowerGroup, groupCount, onCommit }) => {
	const drag = useRef<{
		startY: number;
		upperHeight: number;
		lowerHeight: number;
		columnHeight: number;
		gap: number;
		pointerId: number;
	} | null>(null);

	const measure = useCallback(
		(handle: HTMLElement) => {
			const divider = handle.parentElement;
			const upperElement = divider?.previousElementSibling;
			const lowerElement = divider?.nextElementSibling;
			const column = divider?.closest<HTMLElement>("[data-column-id]");
			if (
				!(upperElement instanceof HTMLElement) ||
				upperElement.dataset.paneGroupId !== upperGroup.id ||
				!(lowerElement instanceof HTMLElement) ||
				lowerElement.dataset.paneGroupId !== lowerGroup.id ||
				!column
			) {
				return null;
			}
			return {
				upperHeight: upperElement.getBoundingClientRect().height,
				lowerHeight: lowerElement.getBoundingClientRect().height,
				columnHeight: column.getBoundingClientRect().height,
				gap: PANE_GAP,
			};
		},
		[lowerGroup.id, upperGroup.id],
	);

	const apply = useCallback(
		(deltaY: number) => {
			const current = drag.current;
			if (!current) return;
			const resized = calculateStackResize({
				columnHeight: current.columnHeight,
				paneCount: groupCount,
				upperHeight: current.upperHeight,
				lowerHeight: current.lowerHeight,
				deltaY,
				gap: current.gap,
			});
			const pairHeight = resized.upperHeight + resized.lowerHeight;
			if (pairHeight <= 0) return;
			onCommit(resized.upperHeight / pairHeight);
		},
		[onCommit, groupCount],
	);

	return (
		<div className="relative h-1 shrink-0">
			<div
				role="separator"
				aria-label={`Resize ${upperGroup.pane.title} and ${lowerGroup.pane.title}`}
				aria-orientation="horizontal"
				tabIndex={0}
				data-qa-id="chat-pane-stack-resize"
				className={cn(
					"group absolute inset-x-0 -inset-y-0.5 z-10 cursor-row-resize touch-none bg-transparent outline-none",
					"before:absolute before:inset-x-0 before:top-1/2 before:h-0.5 before:-translate-y-1/2 before:bg-transparent before:content-['']",
					"hover:before:bg-muted-foreground/35 focus-visible:before:bg-muted-foreground/60 active:before:bg-muted-foreground/60 before:transition-colors before:duration-150 motion-reduce:before:transition-none",
				)}
				onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
					if (event.button !== 0) return;
					const measured = measure(event.currentTarget);
					if (!measured) return;
					event.preventDefault();
					event.stopPropagation();
					event.currentTarget.setPointerCapture(event.pointerId);
					drag.current = { ...measured, startY: event.clientY, pointerId: event.pointerId };
				}}
				onPointerMove={(event) => {
					const current = drag.current;
					if (!current || current.pointerId !== event.pointerId) return;
					event.preventDefault();
					apply(event.clientY - current.startY);
				}}
				onPointerUp={(event) => {
					const current = drag.current;
					if (!current || current.pointerId !== event.pointerId) return;
					apply(event.clientY - current.startY);
					if (event.currentTarget.hasPointerCapture(event.pointerId)) {
						event.currentTarget.releasePointerCapture(event.pointerId);
					}
					drag.current = null;
				}}
				onPointerCancel={(event) => {
					if (event.currentTarget.hasPointerCapture(event.pointerId)) {
						event.currentTarget.releasePointerCapture(event.pointerId);
					}
					drag.current = null;
				}}
				onKeyDown={(event) => {
					if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
					const measured = measure(event.currentTarget);
					if (!measured) return;
					event.preventDefault();
					const step = event.shiftKey ? 40 : 12;
					const resized = calculateStackResize({
						columnHeight: measured.columnHeight,
						paneCount: groupCount,
						upperHeight: measured.upperHeight,
						lowerHeight: measured.lowerHeight,
						deltaY: event.key === "ArrowUp" ? -step : step,
						gap: measured.gap,
					});
					const pairHeight = resized.upperHeight + resized.lowerHeight;
					if (pairHeight > 0) onCommit(resized.upperHeight / pairHeight);
				}}
			/>
		</div>
	);
};

const PaneCanvasColumn: FC<{
	canDrop: (drop: PaneDrop) => boolean;
	column: ProjectedColumn;
	layout: PaneLayout;
	arrangement: Arrangement;
	activeGroupId: string;
	expandedGroupId?: string;
	showResize: boolean;
	poppedOutPaneIds?: ReadonlySet<string>;
	onLayoutChange: (layout: PaneLayout) => void;
	onSelectPane: (paneId: string) => void;
	onClosePane?: (paneId: string) => void;
	onPopOutPane?: (paneId: string) => void;
	onFocusPoppedOutPane?: (paneId: string) => void;
	onDockPoppedOutPane?: (paneId: string) => void;
	onToggleExpand?: (groupId: string, paneId: string) => void;
	expanded?: boolean;
	onResize: (delta: number) => void;
	onDrop: (drop: PaneDrop) => void;
	definitions: readonly RightPanelTabDefinition[];
	showChatInAddMenu: boolean;
	onLaunchChat: (targetGroupId?: string) => void;
	onLaunch: (definition: RightPanelTabDefinition, targetGroupId?: string) => void;
	contentRegistry: PaneContentMountRegistry;
	paneTitleHint?: (paneId: string) => string | undefined;
	iconForPane?: (paneId: string) => PaneIconOverride | undefined;
}> = ({
	canDrop,
	column,
	layout,
	arrangement,
	activeGroupId,
	expandedGroupId,
	showResize,
	poppedOutPaneIds,
	onLayoutChange,
	onSelectPane,
	onClosePane,
	onPopOutPane,
	onFocusPoppedOutPane,
	onDockPoppedOutPane,
	onToggleExpand,
	expanded = false,
	onResize,
	onDrop,
	definitions,
	showChatInAddMenu,
	onLaunchChat,
	onLaunch,
	contentRegistry,
	paneTitleHint,
	iconForPane,
}) => {
	const paneCount = flattenPanes(layout).length;
	const columnExpanded = expandedGroupId
		? column.groups.some((group) => group.id === expandedGroupId)
		: false;
	return (
		<div
			className={cn(
				"relative isolate flex h-full min-h-0 min-w-0 flex-col rounded-sm",
				expandedGroupId ? "flex-1" : "shrink-0",
				(column.groups.some((group) => group.id === activeGroupId) || column.pinned) && "z-10",
			)}
			data-column-id={column.id}
			data-pinned={column.pinned ? "true" : undefined}
			hidden={Boolean(expandedGroupId) && !columnExpanded}
			style={columnExpanded ? { width: "100%" } : { width: column.width }}
		>
			{column.groups.map((group, index) => {
				const sourceGroup = findGroup(layout, group.id) ?? group;
				const pane = group.pane;
				const active = group.id === activeGroupId;
				return (
					<Fragment key={group.id}>
						<Tabs
							value={pane.id}
							className="pane-group relative flex min-h-0 min-w-0 flex-col gap-1"
							data-qa-id={`chat-pane-group-${group.id}`}
							data-pane-group-id={group.id}
							data-group-active={active ? "true" : undefined}
							data-pane-id={pane.id}
							data-pinned={group.pinned ? "true" : undefined}
							hidden={Boolean(expandedGroupId) && group.id !== expandedGroupId}
							style={{ flex: `${group.heightWeight} 1 0%` }}
						>
							<PaneTabStrip
								canDrop={canDrop}
								groupId={group.id}
								panes={sourceGroup.tabs}
								activePaneId={active ? group.pane.id : ""}
								highlighted={paneCount > 1}
								showPinned={arrangement === "carousel" && index === 0}
								pinned={arrangement === "carousel" && column.pinned}
								{...(arrangement === "carousel" && index === 0
									? {
											onPin: () => onLayoutChange(togglePin(layout, group.id)),
										}
									: {})}
								{...(onToggleExpand
									? {
											expanded,
											onExpand: (paneId: string) => onToggleExpand(group.id, paneId),
										}
									: {})}
								{...(poppedOutPaneIds ? { poppedOutPaneIds } : {})}
								{...(onPopOutPane ? { onPopOut: onPopOutPane } : {})}
								{...(onFocusPoppedOutPane ? { onFocusPoppedOut: onFocusPoppedOutPane } : {})}
								{...(onDockPoppedOutPane ? { onDockPoppedOut: onDockPoppedOutPane } : {})}
								titleHint={(paneId) => {
									const fromCaller = paneTitleHint?.(paneId);
									if (fromCaller) return fromCaller;
									const tab = sourceGroup.tabs.find((entry) => entry.id === paneId);
									return tab?.kind === "agent" ? tab.title : undefined;
								}}
								{...(iconForPane ? { iconForPane } : {})}
								onSelect={(paneId) => {
									onLayoutChange(setActivePane(layout, paneId));
									onSelectPane(paneId);
								}}
								onActivateGroup={() => {
									onLayoutChange(setActivePane(layout, group.pane.id));
									onSelectPane(group.pane.id);
								}}
								onDrop={onDrop}
								{...(onClosePane ? { onClose: onClosePane } : {})}
								canClose={(tab) => tab.kind !== "agent" || paneCount > 1}
								trailing={
									<PaneAddTab
										definitions={definitions}
										showChat={showChatInAddMenu}
										onLaunchChat={() => onLaunchChat(group.id)}
										onLaunch={(definition) => onLaunch(definition, group.id)}
									/>
								}
							/>
							<div
								className="relative min-h-0 min-w-0 flex-1"
								data-qa-id={`chat-pane-${pane.id}`}
								onPointerDownCapture={(event) => {
									if (active || event.button !== 0) return;
									onLayoutChange(setActivePane(layout, pane.id));
									onSelectPane(pane.id);
								}}
							>
								<ChatPaneHost kind={pane.kind} active={active} paneId={pane.id}>
									{poppedOutPaneIds?.has(pane.id) ? (
										<TabsContent value={pane.id} className="flex min-h-0 flex-col">
											<PoppedOutPanePlaceholder
												paneId={pane.id}
												{...(onFocusPoppedOutPane ? { onFocus: onFocusPoppedOutPane } : {})}
												{...(onDockPoppedOutPane ? { onDock: onDockPoppedOutPane } : {})}
											/>
										</TabsContent>
									) : (
										group.tabs.map((tab) => {
											if (poppedOutPaneIds?.has(tab.id)) return null;
											const shown = tab.id === pane.id;
											return (
												<TabsContent
													key={tab.id}
													value={tab.id}
													keepMounted
													className="flex min-h-0 flex-1 flex-col overflow-hidden"
													data-qa-id={
														shown ? `chat-pane-content-${tab.id}` : `chat-pane-parked-${tab.id}`
													}
												>
													<PaneContentTarget paneId={tab.id} registry={contentRegistry} />
												</TabsContent>
											);
										})
									)}
								</ChatPaneHost>
							</div>
						</Tabs>
						{!expandedGroupId && index < column.groups.length - 1 && column.groups[index + 1] ? (
							<StackResizeHandle
								upperGroup={group}
								lowerGroup={column.groups[index + 1]!}
								groupCount={column.groups.length}
								onCommit={(upperShare) => {
									onLayoutChange(
										resizeStackDivider(layout, group.id, column.groups[index + 1]!.id, upperShare),
									);
								}}
							/>
						) : null}
					</Fragment>
				);
			})}
			{showResize ? <ResizableHandle ariaLabel="Resize column" onResize={onResize} /> : null}
		</div>
	);
};

export const ChatPaneCanvas: FC<{
	layout: PaneLayout;
	arrangement: Arrangement;
	onLayoutChange: (layout: PaneLayout) => void;
	onSelectPane: (paneId: string) => void;
	onClosePane?: (paneId: string) => void;
	poppedOutPaneIds?: ReadonlySet<string>;
	onPopOutPane?: (paneId: string) => void;
	onFocusPoppedOutPane?: (paneId: string) => void;
	onDockPoppedOutPane?: (paneId: string) => void;
	definitions: readonly RightPanelTabDefinition[];
	revealActivePaneNonce?: number;
	onLaunchChat: (targetGroupId?: string) => void;
	onLaunch: (definition: RightPanelTabDefinition, targetGroupId?: string) => void;
	renderPane: (paneId: string) => ReactNode;
	paneTitleHint?: (paneId: string) => string | undefined;
	iconForPane?: (paneId: string) => PaneIconOverride | undefined;
}> = ({
	layout,
	arrangement,
	onLayoutChange,
	onSelectPane,
	onClosePane,
	poppedOutPaneIds,
	onPopOutPane,
	onFocusPoppedOutPane,
	onDockPoppedOutPane,
	definitions,
	revealActivePaneNonce = 0,
	onLaunchChat,
	onLaunch,
	renderPane,
	paneTitleHint,
	iconForPane,
}) => {
	const viewportRef = useRef<HTMLDivElement>(null);
	const trackRef = useRef<HTMLDivElement>(null);
	const pinnedRef = useRef<HTMLDivElement>(null);
	const contentParkingRef = useRef<HTMLDivElement>(null);
	const [contentRegistry] = useState(() => createPaneContentMountRegistry(contentParkingRef));
	const [columnMountVersion, onColumnReady] = useReducer((version: number) => version + 1, 0);
	const layoutRef = useRef(layout);
	const scrollMotionRef = useRef<ScrollMotion>(createScrollMotion());
	const panRef = useRef<{ pointerId: number; startX: number; scrollLeft: number } | null>(null);
	const userScrolledRef = useRef(false);
	const revealedGroupIdRef = useRef<string | null>(null);
	const revealNonceRef = useRef(revealActivePaneNonce);
	const [viewportWidth, setViewportWidth] = useState(FALLBACK_VIEWPORT_WIDTH);
	const dockedLayout = withoutPoppedOutPanes(layout, poppedOutPaneIds);
	const dockedPanes = flattenPanes(dockedLayout).filter((pane) => !poppedOutPaneIds?.has(pane.id));
	const showChatInAddMenu = !flattenPanes(layout).some((pane) => pane.kind === "agent");
	const activeGroupId = findPaneGroup(dockedLayout, dockedLayout.activePaneId)?.id ?? "";
	const paneExpand = usePaneExpand(arrangement, dockedLayout.groups.length, activeGroupId);
	const projection = projectLayout(dockedLayout, arrangement, viewportWidth);
	const pinnedColumns =
		arrangement === "carousel" ? projection.columns.filter((column) => column.pinned) : [];
	const scrollingColumns =
		arrangement === "carousel"
			? projection.columns.filter((column) => !column.pinned)
			: projection.columns;
	const scrollingColumnsRef = useRef(scrollingColumns);
	scrollingColumnsRef.current = scrollingColumns;
	layoutRef.current = layout;

	usePaneFrameFocus(viewportRef, (paneId) => {
		if (layout.activePaneId === paneId) return;
		onLayoutChange(setActivePane(layout, paneId));
		onSelectPane(paneId);
	});

	useLayoutEffect(() => {
		contentRegistry.restoreParked();
	});

	useEffect(() => {
		const node = viewportRef.current;
		if (!node) return;
		const update = () => {
			const width = node.clientWidth;
			if (width > 0) setViewportWidth(width);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (arrangement !== "carousel") return;
		const viewport = viewportRef.current;
		const track = trackRef.current;
		if (!viewport || !track) return;
		return bindCarouselWheel(viewport, track, () => {
			cancelHorizontalScroll(scrollMotionRef);
			userScrolledRef.current = true;
		});
	}, [arrangement, scrollingColumns.length]);

	useLayoutEffect(() => {
		if (arrangement !== "carousel") return;
		const track = trackRef.current;
		const active = findPaneGroup(dockedLayout, dockedLayout.activePaneId);
		if (!track || !active || active.pinned) return;
		const nonceChanged = revealNonceRef.current !== revealActivePaneNonce;
		if (nonceChanged) {
			revealNonceRef.current = revealActivePaneNonce;
			userScrolledRef.current = false;
		}
		const isNewSelection = revealedGroupIdRef.current !== active.id;
		if (isNewSelection) {
			revealedGroupIdRef.current = active.id;
			userScrolledRef.current = false;
		} else if (userScrolledRef.current) {
			return;
		}
		const columns = scrollingColumnsRef.current;
		const scrollingLayout = {
			...dockedLayout,
			groups: columns.flatMap((column) => column.groups),
		};
		const widths = new Map(columns.map((column) => [column.id, column.width] as const));
		const rect = calculateGroupRects(scrollingLayout, 0, PANE_GAP, widths).find(
			(entry) => entry.id === active.id,
		);
		if (!rect) return;
		const target = getScrollTarget({
			group: rect,
			scrollLeft: nonceChanged ? Number.POSITIVE_INFINITY : track.scrollLeft,
			viewportWidth: track.clientWidth,
			occludedLeft: 0,
		});
		if (target === track.scrollLeft) return;
		if (nonceChanged) {
			cancelHorizontalScroll(scrollMotionRef);
			applyCarouselScroll(track, target);
			return;
		}
		animateHorizontalScroll(track, target, scrollMotionRef);
	}, [arrangement, dockedLayout.activePaneId, revealActivePaneNonce, columnMountVersion]);

	useEffect(() => () => cancelHorizontalScroll(scrollMotionRef), []);

	const canDrop = useCallback((drop: PaneDrop) => {
		const current = layoutRef.current;
		return changesPanePlacement(current, applyPaneDrop(current, drop));
	}, []);

	const onDrop = useCallback(
		(drop: PaneDrop) => {
			const current = layoutRef.current;
			const next = applyPaneDrop(current, drop);
			if (!changesPanePlacement(current, next)) return;
			const currentLocations = paneMountLocations(current);
			const nextLocations = paneMountLocations(next);
			contentRegistry.parkPanes(
				[...currentLocations].flatMap(([paneId, location]) =>
					nextLocations.get(paneId) === location ? [] : [paneId],
				),
			);
			onLayoutChange(next);
			onSelectPane(next.activePaneId);
		},
		[contentRegistry, onLayoutChange, onSelectPane],
	);

	const renderColumn = (
		column: ProjectedColumn,
		index: number,
		siblings: readonly ProjectedColumn[],
	) => (
		<PaneCanvasColumn
			canDrop={canDrop}
			key={column.id}
			column={column}
			layout={layout}
			arrangement={arrangement}
			activeGroupId={activeGroupId}
			{...(paneExpand.expandedGroupId ? { expandedGroupId: paneExpand.expandedGroupId } : {})}
			showResize={
				!paneExpand.isExpanded &&
				(arrangement === "carousel" || (arrangement === "tiles" && index < siblings.length - 1))
			}
			{...(poppedOutPaneIds ? { poppedOutPaneIds } : {})}
			onLayoutChange={onLayoutChange}
			onSelectPane={onSelectPane}
			{...(onClosePane ? { onClosePane } : {})}
			{...(onPopOutPane ? { onPopOutPane } : {})}
			{...(onFocusPoppedOutPane ? { onFocusPoppedOutPane } : {})}
			{...(onDockPoppedOutPane ? { onDockPoppedOutPane } : {})}
			{...(paneExpand.canExpand
				? {
						expanded: paneExpand.isExpanded,
						onToggleExpand: (groupId: string, paneId: string) => {
							if (paneExpand.expandedGroupId === groupId) {
								paneExpand.setExpanded(false);
								return;
							}
							onLayoutChange(setActivePane(layout, paneId));
							onSelectPane(paneId);
							paneExpand.setExpanded(true);
						},
					}
				: {})}
			onResize={(delta) => {
				if (arrangement === "carousel") {
					onLayoutChange(carouselResize(layout, column, delta));
					return;
				}
				onLayoutChange(tileResize(layout, column, siblings[index + 1], delta));
			}}
			onDrop={onDrop}
			definitions={definitions}
			showChatInAddMenu={showChatInAddMenu}
			onLaunchChat={onLaunchChat}
			onLaunch={onLaunch}
			contentRegistry={contentRegistry}
			{...(paneTitleHint ? { paneTitleHint } : {})}
			{...(iconForPane ? { iconForPane } : {})}
		/>
	);

	const onTrackPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		const track = trackRef.current;
		if (!track || !track.contains(event.target as Node)) return;
		cancelHorizontalScroll(scrollMotionRef);
		userScrolledRef.current = true;
		if (!shouldStartCarouselPan(event)) return;
		panRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			scrollLeft: track.scrollLeft,
		};
		track.setPointerCapture(event.pointerId);
		track.dataset.panning = "true";
		event.preventDefault();
	}, []);

	const onTrackPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		const pan = panRef.current;
		if (!pan || pan.pointerId !== event.pointerId) return;
		if (trackRef.current)
			trackRef.current.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
	}, []);

	const finishTrackPan = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		const pan = panRef.current;
		if (!pan || pan.pointerId !== event.pointerId) return;
		const track = trackRef.current;
		if (track?.hasPointerCapture(event.pointerId)) {
			track.releasePointerCapture(event.pointerId);
		}
		if (track) delete track.dataset.panning;
		panRef.current = null;
	}, []);

	return (
		<div
			ref={viewportRef}
			className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col gap-1"
			data-qa-id="kilo-chat-pane-canvas"
			data-arrangement={arrangement}
			data-expanded={paneExpand.isExpanded ? "true" : "false"}
		>
			<div ref={contentParkingRef} className="hidden" aria-hidden />
			{dockedPanes.map((pane) => (
				<PaneContentMount key={pane.id} paneId={pane.id} registry={contentRegistry}>
					{renderPane(pane.id)}
				</PaneContentMount>
			))}
			<div
				className={cn("flex min-h-0 min-w-0 flex-1", arrangement === "carousel" && "gap-1")}
				onPointerDown={arrangement === "carousel" ? onTrackPointerDown : undefined}
				onPointerMove={arrangement === "carousel" ? onTrackPointerMove : undefined}
				onPointerUp={arrangement === "carousel" ? finishTrackPan : undefined}
				onPointerCancel={arrangement === "carousel" ? finishTrackPan : undefined}
			>
				<div
					ref={pinnedRef}
					className={cn(
						"flex h-full shrink-0 gap-1",
						pinnedColumns.length === 0 && "hidden",
						paneExpand.isExpanded &&
							!pinnedColumns.some((column) =>
								column.groups.some((group) => group.id === paneExpand.expandedGroupId),
							) &&
							"hidden",
						paneExpand.isExpanded && "min-w-0 flex-1",
					)}
					data-qa-id="chat-pane-pinned"
				/>
				<div
					ref={trackRef}
					className={cn(
						"flex min-h-0 min-w-0",
						scrollingColumns.length === 0 && "hidden",
						arrangement === "carousel"
							? "scroll-fade-x flex-1 gap-1 [overflow-anchor:none] overflow-x-auto [--scroll-fade-size:1.5rem] [--scroll-fade-reveal:1.5rem]"
							: "flex-1",
						arrangement === "tiles" && "gap-1",
						paneExpand.isExpanded &&
							!scrollingColumns.some((column) =>
								column.groups.some((group) => group.id === paneExpand.expandedGroupId),
							) &&
							"hidden",
					)}
					data-qa-id={arrangement === "carousel" ? "chat-pane-carousel-track" : undefined}
				/>
				{projection.columns.map((column) => {
					const pinned = arrangement === "carousel" && column.pinned;
					const siblings = pinned ? pinnedColumns : scrollingColumns;
					return (
						<PaneColumnMount
							key={column.id}
							containerRef={pinned ? pinnedRef : trackRef}
							order={siblings.indexOf(column)}
							onReady={onColumnReady}
							onBeforeRemove={contentRegistry.parkDescendants}
						>
							{renderColumn(column, siblings.indexOf(column), siblings)}
						</PaneColumnMount>
					);
				})}
			</div>
		</div>
	);
};
