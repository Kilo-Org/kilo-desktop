import { ComposerPrimitive, MessagePrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { useState, type FC } from "react";

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
import { Button } from "@kilo-desktop/ui/components/button";

import { ComposerActionSlotView } from "../composer/composer-actions";
import { KiloLexicalComposerInput } from "../composer/kilo-lexical-composer-input";
import { KiloSlashTrigger } from "../composer/kilo-slash-trigger";
import { MentionIconsContext, MentionTriggers } from "../composer/mention-triggers";
import { useComposerInputWiring } from "../composer/use-composer-input-wiring";
import { ComposerAttachments } from "./attachment";

/**
 * A sent prompt being edited, in place of its bubble: the message's own edit
 * composer, with the main composer's chips, `/` and mention menus,
 * attachments and toolbar (agent, model, approval), but no queue or client
 * commands. Saving asks first, then sends the edit through the runtime's
 * `onEdit`, which reverts to this prompt.
 */
export const UserEditComposer: FC = () => {
	const aui = useAui();
	const canSend = useAuiState((s) => !s.composer.isEmpty);
	const [confirming, setConfirming] = useState(false);
	const { slash, sources, formatter, placeholder, icons, mentionContext } = useComposerInputWiring({
		promptCommandsOnly: true,
	});
	const askToSave = () => {
		if (canSend) setConfirming(true);
	};
	return (
		<MentionIconsContext.Provider value={icons}>
			<MessagePrimitive.Root
				data-slot="aui_user-edit-composer-root"
				data-role="user"
				className="flex flex-col px-2 pb-7"
			>
				<ComposerPrimitive.Unstable_TriggerPopoverRoot>
					<ComposerPrimitive.Root data-qa-id="kilo-edit-message-composer">
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
								queueOnEnter={false}
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
											<Button variant="ghost" size="sm" data-qa-id="kilo-edit-message-cancel" />
										}
									>
										Cancel
									</ComposerPrimitive.Cancel>
									<ComposerPrimitive.Send
										onClick={(event) => {
											// The edit reverts the conversation, so it is confirmed first.
											event.preventDefault();
											askToSave();
										}}
										render={<Button size="sm" data-qa-id="kilo-edit-message-save" />}
									>
										Save
									</ComposerPrimitive.Send>
								</div>
							</div>
						</ComposerPrimitive.AttachmentDropzone>
					</ComposerPrimitive.Root>
				</ComposerPrimitive.Unstable_TriggerPopoverRoot>
				<EditConfirmDialog
					open={confirming}
					onOpenChange={setConfirming}
					onConfirm={() => {
						setConfirming(false);
						void aui.composer.send();
					}}
				/>
			</MessagePrimitive.Root>
		</MentionIconsContext.Provider>
	);
};

const EditConfirmDialog: FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
}> = ({ open, onOpenChange, onConfirm }) => (
	<AlertDialog open={open} onOpenChange={onOpenChange}>
		<AlertDialogContent data-qa-id="kilo-edit-message-dialog">
			<AlertDialogHeader>
				<AlertDialogTitle>Edit this message?</AlertDialogTitle>
				<AlertDialogDescription>
					This reverts the conversation to this message, removing the messages after it and undoing
					their file changes, then sends your edit. This can't be undone.
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
					Revert and send
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialogContent>
	</AlertDialog>
);
