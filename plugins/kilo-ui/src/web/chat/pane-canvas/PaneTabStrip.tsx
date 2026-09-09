import {
	ExternalLinkIcon,
	Maximize2Icon,
	Minimize2Icon,
	PinIcon,
	PinOffIcon,
	XIcon,
} from "lucide-react";
import {
	useCallback,
	useRef,
	type FC,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";

import {
	dropPositionFromPoint,
	type DropPosition,
	type PaneDescriptor,
} from "@anaconda-agentic-desktop/pane-layout";
import { Button } from "@anaconda-agentic-desktop/ui/components/button";
import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";

import { PANE_ACTIVE_TAB_CLASS } from "./pane-chrome.js";
import { PANE_KIND_ICON, PANE_KIND_ICON_CLASS } from "./pane-kind-icon.js";

function tabChromeClassName(active: boolean) {
	return active
		? PANE_ACTIVE_TAB_CLASS
		: "border-border bg-card/70 text-muted-foreground hover:bg-card hover:text-foreground";
}

function stopActionBubble(event: { stopPropagation: () => void }) {
	event.stopPropagation();
}

export const PaneTabStrip: FC<{
	groupId: string;
	panes: readonly PaneDescriptor[];
	activePaneId: string;
	highlighted?: boolean;
	showPinned?: boolean;
	pinned?: boolean;
	onPin?: () => void;
	onPinIntentChange?: (active: boolean) => void;
	poppedOutPaneIds?: ReadonlySet<string>;
	onSelect: (paneId: string) => void;
	onActivateGroup?: () => void;
	onPopOut?: (paneId: string) => void;
	onFocusPoppedOut?: (paneId: string) => void;
	onDockPoppedOut?: (paneId: string) => void;
	expanded?: boolean;
	onExpand?: (paneId: string) => void;
	onClose?: (paneId: string) => void;
	canClose?: (pane: PaneDescriptor) => boolean;
	onMoveToTab?: (paneId: string, targetPaneId: string, position: "before" | "after") => void;
	onMoveToGroup?: (paneId: string, targetGroupId: string, position: DropPosition) => void;
	onMoveGroup?: (sourceGroupId: string, targetGroupId: string, position: DropPosition) => void;
	trailing?: ReactNode;
	titleHint?: (paneId: string) => string | undefined;
}> = ({
	groupId,
	panes,
	activePaneId,
	highlighted = true,
	showPinned = false,
	pinned = false,
	onPin,
	onPinIntentChange,
	poppedOutPaneIds,
	onSelect,
	onActivateGroup,
	onPopOut,
	onFocusPoppedOut,
	onDockPoppedOut,
	expanded = false,
	onExpand,
	onClose,
	canClose,
	onMoveToTab,
	onMoveToGroup,
	onMoveGroup,
	trailing,
	titleHint,
}) => {
	const stripRef = useRef<HTMLDivElement>(null);
	const dragRef = useRef<{
		kind: "pane" | "group";
		pointerId: number;
		sourceId: string;
		startX: number;
		startY: number;
		moved: boolean;
		marker?: HTMLElement;
	} | null>(null);
	const suppressClickRef = useRef<{ kind: "pane" | "group"; sourceId: string } | null>(null);

	const clearMarker = useCallback(() => {
		const drag = dragRef.current;
		if (drag?.marker) delete drag.marker.dataset.dropZone;
	}, []);

	const startPointerDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>, kind: "pane" | "group", sourceId: string) => {
			if (
				event.button !== 0 ||
				(kind === "pane" && !onMoveToTab && !onMoveToGroup) ||
				(kind === "group" && !onMoveGroup)
			) {
				return;
			}
			event.stopPropagation();
			event.currentTarget.setPointerCapture(event.pointerId);
			dragRef.current = {
				kind,
				pointerId: event.pointerId,
				sourceId,
				startX: event.clientX,
				startY: event.clientY,
				moved: false,
			};
		},
		[onMoveGroup, onMoveToGroup, onMoveToTab],
	);

	const onPointerDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== event.pointerId) return;
			if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) {
				return;
			}
			drag.moved = true;
			event.preventDefault();
			const hit = document.elementFromPoint(event.clientX, event.clientY);
			const tab = hit?.closest<HTMLElement>("[data-pane-tab]");
			const group = hit?.closest<HTMLElement>("[data-pane-group-id]");
			if (
				(drag.kind === "pane" && tab?.dataset.paneTab === drag.sourceId) ||
				(drag.kind === "group" && group?.dataset.paneGroupId === drag.sourceId)
			) {
				clearMarker();
				delete drag.marker;
				return;
			}
			const target = drag.kind === "group" ? group : (tab ?? group);
			if (!target) {
				clearMarker();
				delete drag.marker;
				return;
			}
			const position = dropPositionFromPoint(
				target.dataset.paneTab ? "tab" : "group",
				event.clientX,
				event.clientY,
				target.getBoundingClientRect(),
			);
			if (drag.marker && drag.marker !== target) delete drag.marker.dataset.dropZone;
			target.dataset.dropZone = position;
			drag.marker = target;
		},
		[clearMarker],
	);

	const finishPointerDrag = useCallback(
		(event: ReactPointerEvent<HTMLElement>, cancelled = false) => {
			const drag = dragRef.current;
			if (!drag || drag.pointerId !== event.pointerId) return;
			const marker = drag.marker;
			const targetId = marker?.dataset.paneTab;
			const position = marker?.dataset.dropZone;
			clearMarker();
			if (event.currentTarget.hasPointerCapture(event.pointerId)) {
				event.currentTarget.releasePointerCapture(event.pointerId);
			}
			dragRef.current = null;
			if (!drag.moved) return;
			suppressClickRef.current = { kind: drag.kind, sourceId: drag.sourceId };
			if (cancelled || !position) return;
			if (drag.kind === "pane" && targetId && (position === "before" || position === "after")) {
				onMoveToTab?.(drag.sourceId, targetId, position);
				return;
			}
			const targetGroupId =
				marker?.dataset.paneGroupId ??
				marker?.closest<HTMLElement>("[data-pane-group-id]")?.dataset.paneGroupId;
			if (!targetGroupId) return;
			if (drag.kind === "group") {
				onMoveGroup?.(drag.sourceId, targetGroupId, position as DropPosition);
				return;
			}
			onMoveToGroup?.(drag.sourceId, targetGroupId, position as DropPosition);
		},
		[clearMarker, onMoveGroup, onMoveToGroup, onMoveToTab],
	);

	return (
		<div
			ref={stripRef}
			className="group/pane-tabs flex h-7 min-w-0 shrink-0 [scrollbar-width:none] items-stretch gap-1 overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:hidden"
			data-qa-id="chat-pane-tabs"
			data-pane-group-tabs={groupId}
			data-selected={panes.some((pane) => pane.id === activePaneId) || undefined}
			onClick={(event) => {
				if (event.target === event.currentTarget) onActivateGroup?.();
			}}
		>
			<nav className="flex h-7 shrink-0 items-stretch gap-1" role="tablist" aria-label="Panes">
				{panes.map((pane) => {
					const active = pane.id === activePaneId;
					const poppedOut = poppedOutPaneIds?.has(pane.id) === true;
					const dockable = poppedOut && Boolean(onDockPoppedOut);
					const poppable = !poppedOut && Boolean(onPopOut);
					const windowable = dockable || poppable;
					const paneExpanded = active && expanded;
					const Icon = PANE_KIND_ICON[pane.kind];
					const closable = Boolean(onClose) && (canClose?.(pane) ?? pane.kind !== "agent");
					const actionVisibilityClassName = cn(
						"opacity-0 transition-opacity group-hover/pane-tab:opacity-100 group-focus-within/pane-tab:opacity-100",
						active && "opacity-100",
					);
					return (
						<div
							key={pane.id}
							className={cn(
								"group/pane-tab relative flex h-7 min-w-[6.5rem] max-w-44 shrink-0 overflow-hidden rounded-[4px_4px_2px_2px] border transition-colors",
								tabChromeClassName(active && highlighted),
								poppedOut && "border-dashed",
								poppedOut && "border-info/70",
							)}
							data-pane-kind={pane.kind}
							data-pane-tab={pane.id}
							data-active={active ? "true" : undefined}
							data-popped-out={poppedOut ? "true" : undefined}
						>
							<button
								type="button"
								role="tab"
								aria-selected={active}
								title={titleHint?.(pane.id) ?? pane.title}
								className="focus-visible:ring-ring flex min-w-0 flex-1 items-center gap-1.5 px-2 text-left text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset"
								data-qa-id={`chat-pane-tab-${pane.id}`}
								data-popped-out={poppedOut ? "true" : undefined}
								onClick={() => {
									if (
										suppressClickRef.current?.kind === "pane" &&
										suppressClickRef.current.sourceId === pane.id
									) {
										suppressClickRef.current = null;
										return;
									}
									if (poppedOut && onFocusPoppedOut) {
										onFocusPoppedOut(pane.id);
										return;
									}
									onSelect(pane.id);
								}}
								onPointerDown={
									poppedOut ? undefined : (event) => startPointerDrag(event, "pane", pane.id)
								}
								onPointerMove={poppedOut ? undefined : onPointerDrag}
								onPointerUp={poppedOut ? undefined : (event) => finishPointerDrag(event)}
								onPointerCancel={poppedOut ? undefined : (event) => finishPointerDrag(event, true)}
							>
								<Icon
									className={cn("size-3 shrink-0", PANE_KIND_ICON_CLASS[pane.kind])}
									aria-hidden
								/>
								<span className="min-w-0 truncate">{pane.title}</span>
							</button>
							{onExpand ? (
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label={paneExpanded ? `Restore ${pane.title}` : `Expand ${pane.title}`}
									aria-pressed={paneExpanded}
									title={paneExpanded ? "Restore" : "Expand"}
									className={cn(
										"text-muted-foreground hover:text-foreground mt-[3px] size-5 rounded-[3px]",
										actionVisibilityClassName,
										paneExpanded && "bg-foreground/10 text-foreground",
									)}
									data-qa-id={`chat-pane-expand-${pane.id}`}
									onPointerDown={stopActionBubble}
									onClick={(event) => {
										stopActionBubble(event);
										onExpand(pane.id);
									}}
								>
									{paneExpanded ? <Minimize2Icon /> : <Maximize2Icon />}
								</Button>
							) : null}
							{windowable ? (
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label={poppedOut ? `Dock ${pane.title}` : `Pop out ${pane.title}`}
									title={poppedOut ? "Dock" : "Pop out"}
									className={cn(
										"hover:text-foreground mt-[3px] size-5 rounded-[3px]",
										actionVisibilityClassName,
										poppedOut ? "text-info" : "text-muted-foreground",
									)}
									data-qa-id={`chat-pane-${poppedOut ? "dock" : "pop-out"}-tab-${pane.id}`}
									onPointerDown={stopActionBubble}
									onClick={(event) => {
										stopActionBubble(event);
										if (poppedOut) {
											onDockPoppedOut?.(pane.id);
											return;
										}
										onPopOut?.(pane.id);
									}}
								>
									{poppedOut ? <Minimize2Icon /> : <ExternalLinkIcon />}
								</Button>
							) : null}
							{closable && onClose ? (
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									aria-label={`Close ${pane.title}`}
									className={cn(
										"text-muted-foreground hover:text-foreground mt-[3px] mr-0.5 size-5 rounded-[3px]",
										actionVisibilityClassName,
									)}
									data-qa-id={`chat-pane-close-tab-${pane.id}`}
									onPointerDown={stopActionBubble}
									onClick={(event) => {
										stopActionBubble(event);
										onClose(pane.id);
									}}
								>
									<XIcon />
								</Button>
							) : null}
						</div>
					);
				})}
			</nav>
			{trailing}
			{onMoveGroup ? (
				<button
					type="button"
					aria-label="Drag pane group"
					title="Drag pane group"
					className="min-w-6 flex-1 cursor-grab touch-none active:cursor-grabbing"
					data-qa-id={`chat-pane-group-drag-${groupId}`}
					onClick={() => {
						if (
							suppressClickRef.current?.kind === "group" &&
							suppressClickRef.current.sourceId === groupId
						) {
							suppressClickRef.current = null;
							return;
						}
						onActivateGroup?.();
					}}
					onPointerDown={(event) => startPointerDrag(event, "group", groupId)}
					onPointerMove={onPointerDrag}
					onPointerUp={(event) => finishPointerDrag(event)}
					onPointerCancel={(event) => finishPointerDrag(event, true)}
				/>
			) : null}
			{showPinned && onPin ? (
				<Button
					type="button"
					variant="ghost"
					size="icon-xs"
					aria-label={pinned ? "Unpin column" : "Pin column"}
					aria-pressed={pinned}
					title={pinned ? "Unpin column" : "Pin column"}
					className={cn(
						"border-border bg-card/70 text-muted-foreground hover:bg-card hover:text-foreground focus-visible:ring-ring relative ml-auto flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-[4px_4px_2px_2px] border opacity-0 transition-opacity outline-none group-focus-within/pane-tabs:opacity-100 group-hover/pane-tabs:opacity-100 focus-visible:ring-2 focus-visible:ring-inset",
						pinned &&
							"text-amber-600 opacity-100 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300",
					)}
					data-qa-id={`chat-pane-pin-${groupId}`}
					onPointerEnter={() => onPinIntentChange?.(true)}
					onPointerLeave={() => onPinIntentChange?.(false)}
					onFocus={() => onPinIntentChange?.(true)}
					onBlur={() => onPinIntentChange?.(false)}
					onPointerDown={stopActionBubble}
					onClick={(event) => {
						stopActionBubble(event);
						onPin();
					}}
				>
					{pinned ? <PinOffIcon /> : <PinIcon />}
				</Button>
			) : null}
		</div>
	);
};
