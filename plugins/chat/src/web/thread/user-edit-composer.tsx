import { ComposerPrimitive, MessagePrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { CheckIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type FC, type FocusEvent } from "react";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@kilo-desktop/ui/components/alert-dialog";
import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";

import { useRevertRangeHasFileChanges } from "../checkpoints/checkpoint-revert";
import { ComposerActionSlotView } from "../composer/composer-actions";
import { KiloLexicalComposerInput } from "../composer/kilo-lexical-composer-input";
import { KiloSlashTrigger } from "../composer/kilo-slash-trigger";
import { MentionIconsContext, MentionTriggers } from "../composer/mention-triggers";
import { TriggerPopoverPlacementProvider } from "../composer/trigger-popover";
import { useComposerInputWiring } from "../composer/use-composer-input-wiring";
import { ComposerAttachments } from "./attachment";
import { TooltipIconButton } from "./tooltip-icon-button";

/**
 * A sent prompt being edited, in place of its bubble: the message's own edit
 * composer, with the main composer's chips, `/` and mention menus,
 * attachments and toolbar (agent, model, approval), but no queue or client
 * commands. Saving asks first, then sends the edit through the runtime's
 * `onEdit`, which reverts to this prompt; moving focus away cancels it.
 */
export const UserEditComposer: FC = () => {
	const aui = useAui();
	const canSend = useAuiState((s) => !s.composer.isEmpty);
	const [confirming, setConfirming] = useState(false);
	const undoesFileChanges = useRevertRangeHasFileChanges();
	const { slash, sources, formatter, placeholder, icons, mentionContext } = useComposerInputWiring({
		promptCommandsOnly: true,
	});
	const askToSave = () => {
		if (canSend) setConfirming(true);
	};
	const focusLoss = useCancelOnFocusLoss(() => aui.composer.cancel());
	return (
		<MentionIconsContext.Provider value={icons}>
			<TriggerPopoverPlacementProvider value="auto">
				<MessagePrimitive.Root
					data-slot="aui_user-edit-composer-root"
					data-role="user"
					className="flex flex-col px-2 pb-7"
					{...focusLoss}
				>
					<ComposerPrimitive.Unstable_TriggerPopoverRoot>
						<ComposerPrimitive.Root data-qa-id="kilo-edit-message-composer" className="relative">
							<ComposerPrimitive.AttachmentDropzone
								render={
									<div className="bg-pane-raised border-border-subtle focus-within:border-ring data-[dragging=true]:border-ring flex w-full flex-col gap-2 rounded-xl border px-3 pt-2 pb-2 transition-colors data-[dragging=true]:border-dashed" />
								}
							>
								<ComposerAttachments />
								<KiloLexicalComposerInput
									formatter={formatter}
									placeholder={placeholder}
									submitMode="none"
									onSubmitEnter={askToSave}
									cancelOnEscape
									autoFocus
									label="Edit message"
									qaId="kilo-edit-message-input"
								/>
								<KiloSlashTrigger slash={slash} formatter={formatter} />
								<MentionTriggers sources={sources} context={mentionContext} formatter={formatter} />
								<div className="flex items-center justify-between gap-1.5">
									<div className="flex min-w-0 items-center">
										<ComposerActionSlotView slot="toolbar" />
									</div>
									<div className="flex shrink-0 items-center gap-1.5">
										<ComposerActionSlotView slot="toolbar-end" />
										<ComposerPrimitive.Cancel
											render={
												<TooltipIconButton
													tooltip="Cancel"
													side="bottom"
													type="button"
													variant="ghost"
													size="icon"
													className="size-7 rounded-full"
													aria-label="Cancel editing"
													data-qa-id="kilo-edit-message-cancel"
												/>
											}
										>
											<XIcon className="size-4" />
										</ComposerPrimitive.Cancel>
										<ComposerPrimitive.Send
											onClick={(event) => {
												// The edit reverts the conversation, so it is confirmed first.
												event.preventDefault();
												askToSave();
											}}
											render={
												<TooltipIconButton
													tooltip="Save"
													side="bottom"
													type="button"
													variant="default"
													size="icon"
													className="bg-primary-brand text-primary-brand-foreground border-primary-brand-edge hover:bg-primary-brand/85 size-7 rounded-full"
													aria-label="Save edit"
													data-qa-id="kilo-edit-message-save"
												/>
											}
										>
											<CheckIcon className="size-4" />
										</ComposerPrimitive.Send>
									</div>
								</div>
							</ComposerPrimitive.AttachmentDropzone>
						</ComposerPrimitive.Root>
					</ComposerPrimitive.Unstable_TriggerPopoverRoot>
					<EditConfirmDialog
						open={confirming}
						undoesFileChanges={undoesFileChanges}
						onOpenChange={setConfirming}
						onConfirm={() => {
							setConfirming(false);
							void aui.composer.send();
						}}
					/>
				</MessagePrimitive.Root>
			</TriggerPopoverPlacementProvider>
		</MentionIconsContext.Provider>
	);
};

/**
 * Leaving the editor cancels the edit. Focus moving into the editor's own
 * popups (model picker, menus, the confirm dialog) doesn't count: they are
 * portaled outside its DOM, but React bubbles their focus events through the
 * component tree, so a focus arriving right after the blur keeps the edit.
 * Neither does the window losing focus (a file picker, another app), nor a
 * click on the editor's own padding, which drops focus to the page.
 */
function useCancelOnFocusLoss(cancel: () => void) {
	const pending = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const pressedInside = useRef(false);
	const latestCancel = useLatestRef(cancel);
	useEffect(() => () => clearTimeout(pending.current), []);
	return {
		onPointerDownCapture: () => {
			pressedInside.current = true;
		},
		onFocus: () => {
			clearTimeout(pending.current);
			pressedInside.current = false;
		},
		onBlur: (event: FocusEvent<HTMLElement>) => {
			const root = event.currentTarget;
			clearTimeout(pending.current);
			pending.current = setTimeout(() => {
				if (pressedInside.current) {
					pressedInside.current = false;
					root.querySelector<HTMLElement>("[contenteditable]")?.focus({ preventScroll: true });
					return;
				}
				if (!document.hasFocus() || root.contains(document.activeElement)) return;
				latestCancel.current();
			}, 0);
		},
	};
}

/**
 * `undoesFileChanges` follows the turns' recorded changes, as Revert's own
 * offer does; a folder without snapshots records none, so its edits read as
 * leaving files alone, which they do.
 */
const EditConfirmDialog: FC<{
	open: boolean;
	undoesFileChanges: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}> = ({ open, undoesFileChanges, onOpenChange, onConfirm }) => (
	<AlertDialog open={open} onOpenChange={onOpenChange}>
		<AlertDialogContent data-qa-id="kilo-edit-message-dialog">
			<AlertDialogHeader>
				<AlertDialogTitle>Edit this message?</AlertDialogTitle>
				<AlertDialogDescription>
					{undoesFileChanges
						? "This reverts the conversation to this message, removing the messages after it and undoing their file changes, then sends your edit. This can't be undone."
						: "This removes the messages after this one and sends your edit in its place. No files were changed from this message on, so your files stay as they are. This can't be undone."}
				</AlertDialogDescription>
			</AlertDialogHeader>
			<AlertDialogFooter>
				<AlertDialogCancel data-qa-id="kilo-edit-message-dialog-cancel">
					Keep editing
				</AlertDialogCancel>
				<AlertDialogAction
					variant="destructive"
					data-qa-id="kilo-edit-message-dialog-confirm"
					onClick={onConfirm}
				>
					{undoesFileChanges ? "Revert and send" : "Send edit"}
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialogContent>
	</AlertDialog>
);
