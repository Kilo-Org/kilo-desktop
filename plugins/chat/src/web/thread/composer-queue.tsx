import { QueueItemByIndexProvider } from "@assistant-ui/core/react";
import { QueueItemPrimitive, type QueueItemState, useAuiState } from "@assistant-ui/react";
import type { OpenCodeMessageQueueControls } from "@assistant-ui/react-opencode";
import {
	CornerDownLeftIcon,
	FileTextIcon,
	GripVerticalIcon,
	PauseIcon,
	PencilIcon,
	PlayIcon,
	Trash2Icon,
} from "lucide-react";
import { Reorder, useDragControls, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState, type FC, type KeyboardEvent, type PointerEvent } from "react";

import { Button } from "@kilo-desktop/ui/components/button";
import { Item, ItemActions, ItemContent } from "@kilo-desktop/ui/components/item";
import { Textarea } from "@kilo-desktop/ui/components/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@kilo-desktop/ui/components/tooltip";
import { cn } from "@kilo-desktop/ui/lib/utils";
import { useContextKey } from "@kilo-desktop/kernel/web";
import { flagKey } from "@kilo-desktop/plugin-flags/contracts";

import { PROMPT_QUEUE_EDITING_FLAG } from "../../contracts";
import { useMessageQueueControls } from "../runtime/use-message-queue-controls";
import {
	COMPOSER_SHELF_LIST_CLASS,
	COMPOSER_SHELF_ROW_CLASS,
	ComposerShelf,
	ComposerShelfToggle,
} from "./composer-shelf";
import { TooltipIconButton } from "./tooltip-icon-button";

type QueueItemAttachmentPreview = {
	readonly name: string;
	readonly src?: string;
};

type QueueItemWithAttachmentPreview = QueueItemState & {
	readonly attachmentPreview?: QueueItemAttachmentPreview;
};

const ROW_ACTION_REVEAL_CLASS =
	"opacity-65 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100";

const QueueAttachmentPreview: FC<{ attachment: QueueItemAttachmentPreview }> = ({ attachment }) => {
	return (
		<div
			className="border-border-subtle bg-muted flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-md border"
			data-qa-id="kilo-composer-queue-attachment"
		>
			{attachment.src ? (
				<img
					src={attachment.src}
					alt={`${attachment.name} attachment preview`}
					className="size-full object-cover"
				/>
			) : (
				<FileTextIcon
					role="img"
					aria-label={`${attachment.name} attachment`}
					className="text-muted-foreground size-3.5"
				/>
			)}
		</div>
	);
};

/** Single-line prompt that reveals its full text in a tooltip only when it is cut off. */
const QueuePromptText: FC<{ text: string }> = ({ text }) => {
	const textRef = useRef<HTMLSpanElement>(null);
	const [open, setOpen] = useState(false);

	const isTruncated = () => {
		const element = textRef.current;
		return element !== null && element.scrollWidth > element.clientWidth;
	};

	return (
		<Tooltip open={open} onOpenChange={(next) => setOpen(next && isTruncated())}>
			<TooltipTrigger
				render={
					<span
						ref={textRef}
						className="text-foreground/90 block truncate text-sm"
						data-qa-id="kilo-composer-queue-text"
					/>
				}
			>
				{text}
			</TooltipTrigger>
			<TooltipContent side="top" className="max-w-sm" data-qa-id="kilo-composer-queue-tooltip">
				<span className="line-clamp-12 break-words whitespace-pre-wrap">{text}</span>
			</TooltipContent>
		</Tooltip>
	);
};

const QueuePauseButton: FC<{ controls: OpenCodeMessageQueueControls }> = ({ controls }) => {
	const label = controls.paused ? "Resume queue" : "Pause queue";
	return (
		<TooltipIconButton
			tooltip={label}
			side="bottom"
			type="button"
			variant="ghost"
			size="icon-xs"
			className="text-muted-foreground hover:text-foreground size-6"
			aria-label={label}
			onClick={controls.paused ? controls.resume : controls.pause}
			data-qa-id="kilo-composer-queue-pause"
		>
			{controls.paused ? <PlayIcon className="size-3" /> : <PauseIcon className="size-3" />}
		</TooltipIconButton>
	);
};

/** Keeps a drag's local order while dropping ids that left the queue and appending new ones. */
function reconcileOrder(localOrder: readonly string[], liveIds: readonly string[]): string[] {
	const live = new Set(liveIds);
	const kept = localOrder.filter((id) => live.has(id));
	const keptSet = new Set(kept);
	return [...kept, ...liveIds.filter((id) => !keptSet.has(id))];
}

function moveId(ids: readonly string[], id: string, delta: number): string[] | undefined {
	const from = ids.indexOf(id);
	const to = from + delta;
	if (from === -1 || to < 0 || to >= ids.length) return undefined;
	const next = [...ids];
	next.splice(from, 1);
	next.splice(to, 0, id);
	return next;
}

export const ComposerQueue: FC<{ steerOnEnter: boolean }> = ({ steerOnEnter }) => {
	const items = useAuiState((s) => s.composer.queue);
	const enhanced = useContextKey(flagKey(PROMPT_QUEUE_EDITING_FLAG));
	const runtimeControls = useMessageQueueControls();
	const controls = enhanced ? runtimeControls : undefined;
	const [collapsed, setCollapsed] = useState(false);
	const [dragOrder, setDragOrder] = useState<readonly string[] | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const dragOrderRef = useRef<readonly string[] | null>(null);
	const reducedMotion = useReducedMotion();

	if (items.length === 0) return null;

	const liveIds = items.map((item) => item.id);
	const order = dragOrder ? reconcileOrder(dragOrder, liveIds) : liveIds;
	const canReorder = controls !== undefined && items.length > 1 && !controls.editingId;

	const updateDragOrder = (next: readonly string[]) => {
		dragOrderRef.current = next;
		setDragOrder(next);
	};

	const commitDrag = () => {
		const finalOrder = dragOrderRef.current;
		dragOrderRef.current = null;
		setDragOrder(null);
		if (finalOrder) controls?.reorder(reconcileOrder(finalOrder, liveIds));
	};

	const moveByKeyboard = (id: string, delta: number) => {
		const next = moveId(liveIds, id, delta);
		if (!next || !controls) return;
		controls.reorder(next);
		setAnnouncement(`Moved to position ${next.indexOf(id) + 1} of ${next.length}`);
	};

	const listProps = {
		id: "kilo-composer-queue-items",
		role: "list",
		"aria-label": "Queued messages",
		className: cn(COMPOSER_SHELF_LIST_CLASS, "flex flex-col"),
	};

	const rows = order.map((id) => {
		const index = liveIds.indexOf(id);
		const item = items[index];
		if (!item) return null;
		return (
			<QueueItemByIndexProvider key={id} index={index}>
				<QueueItemRow
					queueItem={item}
					isFirst={index === 0}
					showEnterHint={steerOnEnter}
					enhanced={enhanced}
					controls={controls}
					canReorder={canReorder}
					reducedMotion={reducedMotion ?? false}
					onDragStart={() => updateDragOrder(liveIds)}
					onDragEnd={commitDrag}
					onMove={(delta) => moveByKeyboard(id, delta)}
				/>
			</QueueItemByIndexProvider>
		);
	});

	// Collapsing or leaving the chat keeps an open edit (and its hold): the
	// queue in main owns the edit and its draft, so only Save or Cancel
	// releases it, from any window.
	return (
		<ComposerShelf data-qa-id="kilo-composer-queue">
			<ComposerShelfToggle
				collapsed={collapsed}
				aria-controls="kilo-composer-queue-items"
				onClick={() => setCollapsed((value) => !value)}
				data-qa-id="kilo-composer-queue-toggle"
				{...(controls ? { actions: <QueuePauseButton controls={controls} /> } : {})}
			>
				<span>
					{items.length} queued
					{controls?.paused ? <span data-qa-id="kilo-composer-queue-paused"> · Paused</span> : null}
					{controls?.editingId ? (
						<span data-qa-id="kilo-composer-queue-editing"> · Editing</span>
					) : null}
				</span>
			</ComposerShelfToggle>
			{!collapsed && enhanced ? (
				<Reorder.Group
					as="div"
					axis="y"
					layoutScroll
					values={order}
					onReorder={updateDragOrder}
					{...listProps}
				>
					{rows}
				</Reorder.Group>
			) : null}
			{!collapsed && !enhanced ? <div {...listProps}>{rows}</div> : null}
			{enhanced ? (
				<span className="sr-only" aria-live="polite" data-qa-id="kilo-composer-queue-announcer">
					{announcement}
				</span>
			) : null}
		</ComposerShelf>
	);
};

type QueueItemRowProps = {
	queueItem: QueueItemState;
	isFirst: boolean;
	showEnterHint: boolean;
	/** prompt-queue-editing: a draggable Reorder item with a full-text tooltip. */
	enhanced: boolean;
	controls: OpenCodeMessageQueueControls | undefined;
	canReorder: boolean;
	reducedMotion: boolean;
	onDragStart: () => void;
	onDragEnd: () => void;
	onMove: (delta: number) => void;
};

const QueueItemRow: FC<QueueItemRowProps> = ({
	queueItem,
	isFirst,
	showEnterHint,
	enhanced,
	controls,
	canReorder,
	reducedMotion,
	onDragStart,
	onDragEnd,
	onMove,
}) => {
	const dragControls = useDragControls();
	const [dragging, setDragging] = useState(false);
	const isEditing = controls?.editingId === queueItem.id;
	// A remounted row (shelf re-expanded, chat revisited) resumes the open draft.
	const [draft, setDraft] = useState(() => (isEditing ? (controls?.getEditDraft() ?? "") : ""));
	const editButtonRef = useRef<HTMLButtonElement>(null);
	const restoreEditFocus = useRef(false);
	const attachmentPreview = (queueItem as QueueItemWithAttachmentPreview).attachmentPreview;

	useEffect(() => {
		if (isEditing || !restoreEditFocus.current) return;
		restoreEditFocus.current = false;
		editButtonRef.current?.focus();
	}, [isEditing]);

	const beginEdit = () => {
		const text = controls?.beginEdit(queueItem.id);
		if (text !== undefined) setDraft(text);
	};

	const updateDraft = (text: string) => {
		setDraft(text);
		controls?.setEditDraft(text);
	};

	const finishEdit = (commit: boolean) => {
		if (!controls) return;
		if (commit && !controls.commitEdit(queueItem.id, draft)) return;
		if (!commit) controls.cancelEdit();
		restoreEditFocus.current = true;
	};

	const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
		if (!canReorder) return;
		dragControls.start(event);
	};

	const moveWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
		event.preventDefault();
		onMove(event.key === "ArrowUp" ? -1 : 1);
	};

	const reorderItem = (
		<Reorder.Item
			as="div"
			value={queueItem.id}
			dragListener={false}
			dragControls={dragControls}
			onDragStart={() => {
				setDragging(true);
				onDragStart();
			}}
			onDragEnd={() => {
				setDragging(false);
				onDragEnd();
			}}
			{...(reducedMotion ? { transition: { duration: 0 } } : {})}
		/>
	);

	return (
		<Item
			size="xs"
			{...(enhanced ? { render: reorderItem, "data-dragging": dragging } : {})}
			role="listitem"
			className={cn(
				COMPOSER_SHELF_ROW_CLASS,
				enhanced &&
					"data-[dragging=true]:bg-muted data-[dragging=true]:z-10 data-[dragging=true]:shadow-sm data-[dragging=true]:after:hidden",
				isEditing && "h-auto flex-col items-stretch gap-1.5 py-1.5 pr-1.5",
			)}
			data-qa-id="kilo-composer-queue-item"
			data-queue-item-id={queueItem.id}
		>
			{isEditing ? (
				<QueueItemEditor
					draft={draft}
					canSaveEmpty={attachmentPreview !== undefined}
					onDraftChange={updateDraft}
					onSave={() => finishEdit(true)}
					onCancel={() => finishEdit(false)}
				/>
			) : (
				<>
					{canReorder ? (
						<TooltipIconButton
							tooltip="Drag to reorder"
							side="bottom"
							type="button"
							variant="ghost"
							size="icon-xs"
							className={cn(
								"text-muted-foreground hover:text-foreground -ml-1 size-5 shrink-0 cursor-grab touch-none active:cursor-grabbing",
								ROW_ACTION_REVEAL_CLASS,
							)}
							aria-label="Reorder queued message"
							aria-keyshortcuts="ArrowUp ArrowDown"
							onPointerDown={startDrag}
							onKeyDown={moveWithKeyboard}
							data-qa-id="kilo-composer-queue-grip"
						>
							<GripVerticalIcon className="size-3" />
						</TooltipIconButton>
					) : null}
					{attachmentPreview ? <QueueAttachmentPreview attachment={attachmentPreview} /> : null}
					<ItemContent className="min-w-0">
						{enhanced ? (
							<QueuePromptText text={queueItem.prompt} />
						) : (
							<QueueItemPrimitive.Text className="text-foreground/90 truncate text-sm" />
						)}
					</ItemContent>
					<ItemActions className="gap-1.5">
						<QueueItemPrimitive.Steer
							render={
								<Button
									type="button"
									size="xs"
									variant="ghost"
									className={cn(
										"text-muted-foreground hover:text-foreground text-[11px]",
										ROW_ACTION_REVEAL_CLASS,
									)}
									data-qa-id="kilo-composer-queue-send-now"
								/>
							}
						>
							{showEnterHint && isFirst ? (
								<CornerDownLeftIcon aria-hidden className="size-3" />
							) : null}
							Send now
						</QueueItemPrimitive.Steer>
						{controls ? (
							<TooltipIconButton
								ref={editButtonRef}
								tooltip="Edit queued message"
								side="bottom"
								type="button"
								variant="ghost"
								size="icon-xs"
								className={cn(
									"text-muted-foreground hover:text-foreground size-6",
									ROW_ACTION_REVEAL_CLASS,
								)}
								aria-label="Edit queued message"
								onClick={beginEdit}
								data-qa-id="kilo-composer-queue-edit"
							>
								<PencilIcon className="size-3" />
							</TooltipIconButton>
						) : null}
						<QueueItemPrimitive.Remove
							render={
								<TooltipIconButton
									tooltip="Delete queued message"
									side="bottom"
									type="button"
									variant="ghost"
									size="icon-xs"
									className={cn(
										"text-muted-foreground hover:text-destructive size-6",
										ROW_ACTION_REVEAL_CLASS,
									)}
									aria-label="Delete queued message"
									data-qa-id="kilo-composer-queue-delete"
								/>
							}
						>
							<Trash2Icon className="size-3" />
						</QueueItemPrimitive.Remove>
					</ItemActions>
				</>
			)}
		</Item>
	);
};

type QueueItemEditorProps = {
	draft: string;
	/** Attachment-only messages may be saved without text. */
	canSaveEmpty: boolean;
	onDraftChange: (draft: string) => void;
	onSave: () => void;
	onCancel: () => void;
};

const QueueItemEditor: FC<QueueItemEditorProps> = ({
	draft,
	canSaveEmpty,
	onDraftChange,
	onSave,
	onCancel,
}) => {
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const canSave = canSaveEmpty || draft.trim().length > 0;

	useEffect(() => {
		const input = inputRef.current;
		if (!input) return;
		input.focus();
		input.setSelectionRange(input.value.length, input.value.length);
	}, []);

	const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		if (event.key === "Escape") {
			event.preventDefault();
			// Keep composer/global Escape handlers (e.g. stop run) from firing.
			event.stopPropagation();
			onCancel();
			return;
		}
		if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
			event.preventDefault();
			if (canSave) onSave();
		}
	};

	return (
		<>
			<Textarea
				ref={inputRef}
				value={draft}
				onChange={(event) => onDraftChange(event.target.value)}
				onKeyDown={handleKeyDown}
				aria-label="Edit queued message"
				rows={1}
				className="max-h-28 min-h-8 resize-none overflow-y-auto px-2 py-1.5 md:text-sm"
				data-qa-id="kilo-composer-queue-edit-input"
			/>
			<div className="flex items-center justify-end gap-1.5">
				<Button
					type="button"
					size="xs"
					variant="ghost"
					className="text-muted-foreground hover:text-foreground"
					onClick={onCancel}
					data-qa-id="kilo-composer-queue-edit-cancel"
				>
					Cancel
				</Button>
				<Button
					type="button"
					size="xs"
					disabled={!canSave}
					onClick={onSave}
					data-qa-id="kilo-composer-queue-edit-save"
				>
					Save
				</Button>
			</div>
		</>
	);
};
