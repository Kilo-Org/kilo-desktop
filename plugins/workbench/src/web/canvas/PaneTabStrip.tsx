import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import {
	ExternalLinkIcon,
	Maximize2Icon,
	Minimize2Icon,
	PinIcon,
	PinOffIcon,
	XIcon,
} from "lucide-react";
import type { CSSProperties, FC, ReactNode } from "react";

import type { PaneDescriptor } from "@kilo-desktop/pane-layout";
import { Button } from "@kilo-desktop/ui/components/button";
import {
	PANE_TAB_TONE_CLASS_NAME,
	PANE_TAB_TRIGGER_CLASS_NAME,
	type PaneTabTone,
} from "@kilo-desktop/ui/components/pane-tabs";
import { Toggle } from "@kilo-desktop/ui/components/toggle";
import { cn } from "@kilo-desktop/ui/lib/utils";

import type { PaneDrop } from "./pane-drop";
import { PANE_KIND_ICON, PANE_KIND_ICON_CLASS, type PaneIconOverride } from "./pane-kind-icon";
import { PaneTabScrollArea } from "./PaneTabScrollArea";
import { PaneTabTooltip } from "./PaneTabTooltip";
import { ShortcutHintChip } from "./ShortcutHintChip";
import { usePaneDrag } from "./use-pane-drag";
import "./pane-drag.css";

function stopActionBubble(event: { stopPropagation: () => void }) {
	event.stopPropagation();
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
				{panes.map((pane) => {
					const active = pane.id === activePaneId;
					const tone: PaneTabTone =
						active && highlighted ? "focused" : pane.id === selectedPaneId ? "selected" : "idle";
					const poppedOut = poppedOutPaneIds?.has(pane.id) === true;
					const dockable = poppedOut && Boolean(onDockPoppedOut);
					const poppable = !poppedOut && Boolean(onPopOut);
					const windowable = dockable || poppable;
					const paneExpanded = active && expanded;
					const iconOverride = iconForPane?.(pane.id);
					const shortcutHint = shortcutHints?.get(pane.id);
					const Icon = iconOverride?.Icon ?? PANE_KIND_ICON[pane.kind];
					const ExpandIcon = paneExpanded ? Minimize2Icon : Maximize2Icon;
					const WindowIcon = poppedOut ? Minimize2Icon : ExternalLinkIcon;
					const closable = Boolean(onClose) && (canClose?.(pane) ?? true);
					const actionCount = Number(Boolean(onExpand)) + Number(windowable) + Number(closable);
					const actionVisibilityClassName = cn(
						"pointer-events-none absolute inset-y-0 right-0.5 z-10 flex items-center opacity-0 transition-opacity duration-150 motion-reduce:transition-none group-hover/pane-tab:pointer-events-auto group-hover/pane-tab:opacity-100 group-focus-within/pane-tab:pointer-events-auto group-focus-within/pane-tab:opacity-100",
						active && "pointer-events-auto opacity-100",
					);
					return (
						<div
							key={pane.id}
							className={cn(
								"group/pane-tab relative flex h-7 min-w-40 max-w-56 shrink-0 overflow-hidden rounded-md transition-colors",
								PANE_TAB_TONE_CLASS_NAME[tone],
								poppedOut && "border border-dashed border-info/70",
							)}
							data-pane-kind={pane.kind}
							data-pane-tab={pane.id}
							data-active={active ? "true" : undefined}
							data-popped-out={poppedOut ? "true" : undefined}
							style={
								{ "--pane-tab-actions-width": `${actionCount * 1.25 + 0.5}rem` } as CSSProperties
							}
						>
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
								<Icon
									className={cn(
										"size-3.5 shrink-0",
										iconOverride ? undefined : PANE_KIND_ICON_CLASS[pane.kind],
									)}
									{...(iconOverride?.iconKey ? { iconKey: iconOverride.iconKey } : {})}
									aria-hidden
								/>
								<span
									className={cn(
										"min-w-0 flex-1 truncate text-left",
										shortcutHint
											? // Room for the widest chip ("Ctrl+9"), which overlays the title's end.
												"[mask-image:linear-gradient(to_right,black_calc(100%-3.25rem),transparent_calc(100%-2.75rem))]"
											: actionCount > 0 &&
													"group-hover/pane-tab:[mask-image:linear-gradient(to_right,black_calc(100%-var(--pane-tab-actions-width)),transparent_calc(100%-var(--pane-tab-actions-width)+0.5rem))] group-focus-within/pane-tab:[mask-image:linear-gradient(to_right,black_calc(100%-var(--pane-tab-actions-width)),transparent_calc(100%-var(--pane-tab-actions-width)+0.5rem))] group-data-[active]/pane-tab:[mask-image:linear-gradient(to_right,black_calc(100%-var(--pane-tab-actions-width)),transparent_calc(100%-var(--pane-tab-actions-width)+0.5rem))]",
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
								{onExpand ? (
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
								{windowable ? (
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
						</div>
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
