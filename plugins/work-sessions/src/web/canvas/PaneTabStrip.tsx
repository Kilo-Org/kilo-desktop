import { ContextMenu } from "@base-ui/react/context-menu";
import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import {
	ExternalLinkIcon,
	Maximize2Icon,
	Minimize2Icon,
	PinIcon,
	PinOffIcon,
	XIcon,
} from "lucide-react";
import type { FC, ReactNode } from "react";

import type { PaneDescriptor } from "@kilo-desktop/pane-layout";
import { Button } from "@kilo-desktop/ui/components/button";
import { DropdownMenuContent } from "@kilo-desktop/ui/components/dropdown-menu";
import {
	PANE_TAB_STATUS_ICON_CLASS_NAME,
	PANE_TAB_TONE_CLASS_NAME,
	PANE_TAB_TRIGGER_CLASS_NAME,
	PaneTabStatusIcon,
	type PaneTabTone,
} from "@kilo-desktop/ui/components/pane-tabs";
import { Toggle } from "@kilo-desktop/ui/components/toggle";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { PaneStatus } from "../../contracts";
import type { PaneDrop } from "./pane-drop";
import { PANE_KIND_ICON, PANE_KIND_ICON_CLASS, type PaneIconOverride } from "./pane-kind-icon";
import { PaneTabScrollArea } from "./PaneTabScrollArea";
import { PaneTabTooltip } from "./PaneTabTooltip";
import { ShortcutHintChip } from "../shared/ShortcutHintChip";
import { usePaneDrag } from "./use-pane-drag";
import "./pane-drag.css";

function stopActionBubble(event: { stopPropagation: () => void }) {
	event.stopPropagation();
}

/** The tab a right-click menu is for, with its group's tabs (for "close others" and "close to the right"). */
export interface PaneTabMenuTarget {
	readonly pane: PaneDescriptor;
	readonly index: number;
	readonly groupTabs: readonly PaneDescriptor[];
}

export const PaneTabStrip: FC<{
	canDrop?: (drop: PaneDrop) => boolean;
	groupId: string;
	panes: readonly PaneDescriptor[];
	activePaneId: string;
	/** The tab the group is showing; `activePaneId` is empty while the group lacks focus. */
	selectedPaneId?: string;
	highlighted?: boolean;
	showPinned?: boolean;
	pinned?: boolean;
	onPin?: () => void;
	poppedOutPaneIds?: ReadonlySet<string>;
	onSelect: (paneId: string) => void;
	onActivateGroup?: () => void;
	onPopOut?: (paneId: string) => void;
	onDockPoppedOut?: (paneId: string) => void;
	expanded?: boolean;
	onExpand?: (paneId: string) => void;
	onClose?: (paneId: string) => void;
	canClose?: (pane: PaneDescriptor) => boolean;
	onDrop?: (drop: PaneDrop) => void;
	trailing?: ReactNode;
	titleHint?: (paneId: string) => string | undefined;
	iconForPane?: (paneId: string) => PaneIconOverride | undefined;
	shortcutHints?: ReadonlyMap<string, string>;
	statusForPane?: (paneId: string) => PaneStatus | undefined;
	/**
	 * A tab's right-click menu items. Called for every tab on every render, so
	 * it should only build an element; the items mount while the menu is open.
	 */
	tabMenu?: (tab: PaneTabMenuTarget) => ReactNode;
}> = ({
	canDrop,
	groupId,
	panes,
	activePaneId,
	selectedPaneId = activePaneId,
	highlighted = true,
	showPinned = false,
	pinned = false,
	onPin,
	poppedOutPaneIds,
	onSelect,
	onActivateGroup,
	onPopOut,
	onDockPoppedOut,
	expanded = false,
	onExpand,
	onClose,
	canClose,
	onDrop,
	trailing,
	titleHint,
	iconForPane,
	shortcutHints,
	statusForPane,
	tabMenu,
}) => {
	const { stripRef, suppressClickRef, startPointerDrag, onPointerDrag, finishPointerDrag } =
		usePaneDrag({ onDrop, canDrop });

	return (
		<PaneTabScrollArea
			scrollRef={stripRef}
			tabIds={panes.map((pane) => pane.id)}
			activeTabId={activePaneId}
			className="group/pane-tabs no-scrollbar scroll-fade-x flex h-10 min-w-0 shrink-0 [scroll-padding-inline:1.25rem] items-stretch gap-1 overflow-x-auto overflow-y-hidden p-1.5 [--scroll-fade-reveal:1.25rem]"
			data-qa-id="chat-pane-tabs"
			data-pane-group-tabs={groupId}
			data-selected={panes.some((pane) => pane.id === activePaneId) || undefined}
			onClick={(event) => {
				if (event.target === event.currentTarget) onActivateGroup?.();
			}}
		>
			{/* Pane tabs are chrome-wrapped buttons rather than a stock tab list, so
			    they use the Tabs primitive directly for its roving focus and ARIA. */}
			<TabsPrimitive.List
				data-slot="tabs-list"
				className="text-muted-foreground inline-flex h-7 w-fit shrink-0 items-stretch justify-center gap-1"
				aria-label="Panes"
			>
				{panes.map((pane, index) => {
					const active = pane.id === activePaneId;
					// The tab its group shows: it alone offers expand and pop out, and keeps its buttons visible.
					const shown = pane.id === selectedPaneId;
					const tone: PaneTabTone =
						active && highlighted ? "focused" : pane.id === selectedPaneId ? "selected" : "idle";
					const poppedOut = poppedOutPaneIds?.has(pane.id) === true;
					const dockable = poppedOut && Boolean(onDockPoppedOut);
					const poppable = !poppedOut && Boolean(onPopOut);
					const windowable = dockable || poppable;
					const paneExpanded = active && expanded;
					const iconOverride = iconForPane?.(pane.id);
					const shortcutHint = shortcutHints?.get(pane.id);
					const status = statusForPane?.(pane.id);
					const Icon = iconOverride?.Icon ?? PANE_KIND_ICON[pane.kind];
					const ExpandIcon = paneExpanded ? Minimize2Icon : Maximize2Icon;
					const WindowIcon = poppedOut ? Minimize2Icon : ExternalLinkIcon;
					const closable = Boolean(onClose) && (canClose?.(pane) ?? true);
					// Instant, like browser tabs: space is kept, so hovering never moves the title.
					// Buttons drop their `transition-all`, which would otherwise animate the inherited visibility.
					const actionVisibilityClassName = cn(
						"flex shrink-0 items-center pr-0.5 invisible group-hover/pane-tab:visible group-focus-within/pane-tab:visible [&_button]:transition-none",
						shown && "visible",
					);
					const tabProps = {
						className: cn(
							"group/pane-tab relative flex h-7 w-56 shrink-0 overflow-hidden rounded-md",
							PANE_TAB_TONE_CLASS_NAME[tone],
							poppedOut && "border border-dashed border-info/70",
						),
						"data-pane-kind": pane.kind,
						"data-pane-tab": pane.id,
						"data-active": active ? "true" : undefined,
						"data-popped-out": poppedOut ? "true" : undefined,
					};
					const content = (
						<>
							<TabsPrimitive.Tab
								data-slot="tabs-trigger"
								aria-description={titleHint?.(pane.id)}
								value={pane.id}
								type="button"
								className={cn(PANE_TAB_TRIGGER_CLASS_NAME, "cursor-grab touch-none")}
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
									onSelect(pane.id);
								}}
								onPointerDown={
									poppedOut ? undefined : (event) => startPointerDrag(event, "pane", pane.id)
								}
								onPointerMove={poppedOut ? undefined : onPointerDrag}
								onPointerUp={poppedOut ? undefined : (event) => finishPointerDrag(event)}
								onPointerCancel={poppedOut ? undefined : (event) => finishPointerDrag(event, true)}
								onLostPointerCapture={
									poppedOut ? undefined : (event) => finishPointerDrag(event, true)
								}
							>
								<PaneTabStatusIcon status={status} data-qa-id={`chat-pane-tab-status-${pane.id}`}>
									<Icon
										className={cn(
											"size-3.5 shrink-0",
											status
												? PANE_TAB_STATUS_ICON_CLASS_NAME[status]
												: iconOverride
													? undefined
													: PANE_KIND_ICON_CLASS[pane.kind],
										)}
										{...(iconOverride?.iconKey ? { iconKey: iconOverride.iconKey } : {})}
										{...(iconOverride && status ? { status } : {})}
										aria-hidden
									/>
								</PaneTabStatusIcon>
								<span
									className={cn(
										"min-w-0 flex-1 truncate text-left",
										// Room for the widest chip ("Ctrl+9"), which overlays the title's end.
										shortcutHint &&
											"[mask-image:linear-gradient(to_right,black_calc(100%-3.25rem),transparent_calc(100%-2.75rem))]",
									)}
								>
									{pane.title}
								</span>
							</TabsPrimitive.Tab>
							{shortcutHint ? (
								// Overlaid, not in the flow, so holding the modifier never resizes the tab.
								<span className="pointer-events-none absolute inset-y-0 right-1.5 flex items-center">
									<ShortcutHintChip label={shortcutHint} />
								</span>
							) : null}
							<div className={cn(actionVisibilityClassName, shortcutHint && "hidden")}>
								{/* Other tabs offer only close. */}
								{shown && onExpand ? (
									<PaneTabTooltip content={paneExpanded ? "Restore" : "Expand"}>
										<Button
											type="button"
											variant={paneExpanded ? "secondary" : "ghost"}
											size="icon-xs"
											aria-label={paneExpanded ? `Restore ${pane.title}` : `Expand ${pane.title}`}
											aria-pressed={paneExpanded}
											data-qa-id={`chat-pane-expand-${pane.id}`}
											onPointerDown={stopActionBubble}
											onClick={(event) => {
												stopActionBubble(event);
												onExpand(pane.id);
											}}
										>
											<ExpandIcon className="size-3.5" />
										</Button>
									</PaneTabTooltip>
								) : null}
								{(shown || poppedOut) && windowable ? (
									<PaneTabTooltip content={poppedOut ? "Dock" : "Pop out"}>
										<Button
											type="button"
											variant="ghost"
											size="icon-xs"
											aria-label={poppedOut ? `Dock ${pane.title}` : `Pop out ${pane.title}`}
											className={cn(poppedOut && "text-info")}
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
											<WindowIcon className="size-3.5" />
										</Button>
									</PaneTabTooltip>
								) : null}
								{closable && onClose ? (
									<Button
										type="button"
										variant="ghost"
										size="icon-xs"
										aria-label={`Close ${pane.title}`}
										data-qa-id={`chat-pane-close-tab-${pane.id}`}
										onPointerDown={stopActionBubble}
										onClick={(event) => {
											stopActionBubble(event);
											onClose(pane.id);
										}}
									>
										<XIcon className="size-3.5" />
									</Button>
								) : null}
							</div>
						</>
					);
					if (!tabMenu) {
						return (
							<div key={pane.id} {...tabProps}>
								{content}
							</div>
						);
					}
					return (
						<ContextMenu.Root key={pane.id}>
							<ContextMenu.Trigger {...tabProps}>{content}</ContextMenu.Trigger>
							{/* Always mounted: unmounting it mid-close leaves Base UI's menu stuck open on remount. */}
							<DropdownMenuContent side="bottom" align="start">
								{tabMenu({ pane, index, groupTabs: panes })}
							</DropdownMenuContent>
						</ContextMenu.Root>
					);
				})}
			</TabsPrimitive.List>
			{trailing}
			{onDrop ? (
				<button
					type="button"
					aria-label="Drag pane group"
					className="-my-1.5 -ml-1 min-w-8 flex-1 shrink-0 cursor-grab touch-none active:cursor-grabbing"
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
					onLostPointerCapture={(event) => finishPointerDrag(event, true)}
				/>
			) : null}
			{showPinned && onPin ? (
				<PaneTabTooltip content={pinned ? "Unpin column" : "Pin column"}>
					<Toggle
						size="sm"
						aria-label={pinned ? "Unpin column" : "Pin column"}
						pressed={pinned}
						className={cn(
							"relative ml-auto opacity-0 transition-opacity group-focus-within/pane-tabs:opacity-100 group-hover/pane-tabs:opacity-100 group-data-[selected]/pane-tabs:opacity-100",
							pinned && "opacity-100",
						)}
						data-qa-id={`chat-pane-pin-${groupId}`}
						onPointerDown={stopActionBubble}
						onClick={stopActionBubble}
						onPressedChange={() => onPin()}
					>
						{pinned ? <PinOffIcon className="size-3.5" /> : <PinIcon className="size-3.5" />}
					</Toggle>
				</PaneTabTooltip>
			) : null}
		</PaneTabScrollArea>
	);
};
