import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";
import { useAui, useAuiState } from "@assistant-ui/react";
import { LexicalComposerInput, type DirectiveChipProps } from "@assistant-ui/react-lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	COMMAND_PRIORITY_CRITICAL,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	KEY_ENTER_COMMAND,
	PASTE_COMMAND,
} from "lexical";
import { type FC, type KeyboardEvent, type Ref, useEffect } from "react";

import { slashCategoryIcon } from "../../slash-commands/kilo-slash-icons.js";
import { useKiloSlashFormatter } from "../../slash-commands/use-kilo-slash-formatter.js";

type KiloLexicalComposerInputProps = {
	ref?: Ref<HTMLDivElement>;
	disabled?: boolean;
	cancelOnEscape?: boolean;
	submitMode?: "enter" | "ctrlEnter" | "none";
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
};

export const KiloLexicalComposerInput: FC<KiloLexicalComposerInputProps> = ({
	ref,
	disabled = false,
	cancelOnEscape,
	submitMode,
	onKeyDown,
}) => {
	const formatter = useKiloSlashFormatter();
	return (
		<LexicalComposerInput
			ref={(node) => {
				if (typeof ref === "function") ref(node);
				else if (ref) ref.current = node;
				node?.querySelector("[contenteditable]")?.setAttribute("aria-label", "Message input");
			}}
			formatter={formatter}
			directiveChip={KiloSlashDirectiveChip}
			placeholder="Send a message, or / for commands..."
			cancelOnEscape={cancelOnEscape}
			submitMode={submitMode}
			aria-label="Message input"
			onKeyDown={onKeyDown}
			className={cn(
				"aui-composer-input caret-foreground max-h-32 w-full bg-transparent px-1 pt-0 pb-1 text-sm",
				disabled && "pointer-events-none cursor-not-allowed opacity-60",
			)}
		>
			<LexicalInputAria label="Message input" />
			<AttachmentPastePlugin />
			<SteerQueueOnEnterPlugin disabled={disabled} submitMode={submitMode} />
			<QueueEnterWhileRunningPlugin />
		</LexicalComposerInput>
	);
};

const KiloSlashDirectiveChip: FC<DirectiveChipProps> = ({ directiveId, directiveType, label }) => {
	const Icon = slashCategoryIcon(directiveType);
	return (
		<span
			data-slot="directive-text-chip"
			data-directive-type={directiveType}
			data-directive-id={directiveId}
			aria-label={`${directiveType}: ${label}`}
			className="aui-directive-chip"
		>
			<Icon />
			{label}
		</span>
	);
};

function LexicalInputAria({ label }: { label: string }) {
	const [editor] = useLexicalComposerContext();
	const root = editor.getRootElement();
	if (root?.getAttribute("aria-label") !== label) {
		root?.setAttribute("aria-label", label);
	}
	return null;
}

// LexicalComposerInput has no equivalent of ComposerPrimitive.Input's
// addAttachmentOnPaste, so pasted files must be intercepted here. Runs at HIGH
// priority, ahead of PlainTextPlugin's EDITOR-priority text insertion; returning
// true plus preventDefault suppresses both text insertion and the follow-up
// beforeinput insertFromPaste dispatch.
function AttachmentPastePlugin() {
	const [editor] = useLexicalComposerContext();
	const aui = useAui();

	useEffect(() => {
		return editor.registerCommand(
			PASTE_COMMAND,
			(event) => {
				const data =
					event instanceof ClipboardEvent
						? event.clipboardData
						: event instanceof InputEvent
							? event.dataTransfer
							: null;
				const files = Array.from(data?.files ?? []);
				if (!aui.thread.getState().capabilities.attachments || files.length === 0) {
					return false;
				}
				event.preventDefault();
				for (const file of files) {
					void aui.composer.addAttachment(file).catch(() => {
						// The composer runtime emits composer.attachmentAddError before rejecting.
					});
				}
				return true;
			},
			COMMAND_PRIORITY_HIGH,
		);
	}, [aui, editor]);

	return null;
}

// With an empty composer and a non-empty queue, Enter steers the top queued
// message (same as its "Send now" button). Must run at CRITICAL priority: the
// built-in HIGH handler preventDefaults Enter on an empty composer when idle,
// so a LOW-priority handler would never see the idle case.
function SteerQueueOnEnterPlugin({
	disabled,
	submitMode,
}: {
	disabled: boolean;
	submitMode?: "enter" | "ctrlEnter" | "none" | undefined;
}) {
	const [editor] = useLexicalComposerContext();
	const aui = useAui();
	const canQueue = useAuiState((s) => s.thread.capabilities.queue);

	useEffect(() => {
		return editor.registerCommand(
			KEY_ENTER_COMMAND,
			(event) => {
				if (disabled || submitMode !== "enter") return false;
				if (!event || event.shiftKey || event.isComposing || event.ctrlKey || event.metaKey) {
					return false;
				}
				if (!canQueue) return false;
				const composer = aui.composer.getState();
				if (!composer.isEmpty || composer.queue.length === 0) return false;
				event.preventDefault();
				aui.composer.queueItem({ index: 0 }).steer();
				return true;
			},
			COMMAND_PRIORITY_CRITICAL,
		);
	}, [aui, canQueue, disabled, editor, submitMode]);

	return null;
}

function QueueEnterWhileRunningPlugin() {
	const [editor] = useLexicalComposerContext();
	const aui = useAui();
	const canQueue = useAuiState((s) => s.thread.capabilities.queue);

	useEffect(() => {
		return editor.registerCommand(
			KEY_ENTER_COMMAND,
			(event) => {
				if (!event || event.shiftKey || event.isComposing || event.ctrlKey || event.metaKey) {
					return false;
				}
				if (!canQueue || !aui.thread.getState().isRunning) return false;
				if (aui.composer.getState().isEmpty) return false;
				event.preventDefault();
				aui.composer.send();
				return true;
			},
			COMMAND_PRIORITY_LOW,
		);
	}, [aui, canQueue, editor]);

	return null;
}
