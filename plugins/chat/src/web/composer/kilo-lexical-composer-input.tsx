import { useLatestRef } from "@kilo-desktop/ui/hooks/use-latest-ref";
import { cn } from "@kilo-desktop/ui/lib/utils";
import { useAui, useAuiState } from "@assistant-ui/react";
import { LexicalComposerInput } from "@assistant-ui/react-lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
	COMMAND_PRIORITY_CRITICAL,
	COMMAND_PRIORITY_HIGH,
	COMMAND_PRIORITY_LOW,
	KEY_ENTER_COMMAND,
	PASTE_COMMAND,
} from "lexical";
import type { Unstable_DirectiveFormatter } from "@assistant-ui/react";
import {
	type CSSProperties,
	type FC,
	type KeyboardEvent,
	type Ref,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import { KiloDirectiveChip } from "./directive-chip";
import { isSendEnter, type SendKey } from "./send-key";

type KiloLexicalComposerInputProps = {
	ref?: Ref<HTMLDivElement>;
	/** Writes and reads chips (slash commands, mentions) in the composer's text. */
	formatter: Unstable_DirectiveFormatter;
	placeholder?: string;
	disabled?: boolean;
	cancelOnEscape?: boolean;
	/** The Enter that sends, queues, steers, runs a typed `/` command and refines a plan. */
	sendKey: SendKey;
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
	/** Takes the send Enter before sending or queueing does, when it returns true. */
	onEnter?: () => boolean;
	/** Inline sizing, e.g. a `maxHeight` replacing the default auto-grow cap. */
	style?: CSSProperties | undefined;
};

/**
 * The composer's rich input (Lexical): chips for slash commands and mentions,
 * the send key (Enter or Ctrl/Cmd+Enter; the other Enter and Shift+Enter add a
 * new line), pasted files as attachments, and the send key on an empty
 * composer to send the next queued prompt now.
 */
export const KiloLexicalComposerInput: FC<KiloLexicalComposerInputProps> = ({
	ref,
	formatter,
	placeholder = "Send a message or / for commands…",
	disabled = false,
	cancelOnEscape,
	sendKey,
	onKeyDown,
	onEnter,
	style,
}) => {
	const editorGeneration = useEditorGeneration();
	// Cached on `ref`, so a re-render doesn't detach and re-attach it (and set the label again).
	const attachInput = (node: HTMLDivElement | null) => {
		if (typeof ref === "function") ref(node);
		else if (ref) ref.current = node;
		node?.querySelector("[contenteditable]")?.setAttribute("aria-label", "Message input");
	};
	return (
		<LexicalComposerInput
			key={editorGeneration}
			ref={attachInput}
			formatter={formatter}
			directiveChip={KiloDirectiveChip}
			placeholder={placeholder}
			cancelOnEscape={cancelOnEscape}
			submitMode={sendKey}
			aria-label="Message input"
			onKeyDown={onKeyDown}
			className={cn(
				"aui-composer-input caret-foreground max-h-32 w-full bg-transparent px-1 pt-0 pb-1 text-sm",
				disabled && "pointer-events-none cursor-not-allowed opacity-60",
			)}
			style={style}
		>
			<LexicalInputAria label="Message input" />
			<AttachmentPastePlugin />
			<SteerQueueOnEnterPlugin disabled={disabled} sendKey={sendKey} />
			<QueueEnterWhileRunningPlugin sendKey={sendKey} />
			{onEnter ? <EnterOverridePlugin onEnter={onEnter} sendKey={sendKey} /> : null}
		</LexicalComposerInput>
	);
};

/**
 * Counts the times the composer is shown again after being hidden, e.g. in a
 * kept work session under a hidden `Activity`, to key a new Lexical editor
 * each time. Hiding runs effect cleanups, and LexicalExtensionComposer's
 * disposes its editor for good: the editor is built once, in a `useMemo`, so
 * showing the composer again would reuse it without the extensions dispose
 * unregistered (text insertion into an empty composer, select all, undo).
 * The new editor takes the composer's text from SyncPlugin.
 */
function useEditorGeneration(): number {
	const [generation, setGeneration] = useState(0);
	const disposed = useRef(false);
	useLayoutEffect(() => {
		// Lexical skips disposing on StrictMode's synchronous unmount and remount,
		// disposing only once a microtask has passed since mounting; so does this.
		let settled = false;
		queueMicrotask(() => {
			settled = true;
		});
		if (disposed.current) {
			disposed.current = false;
			setGeneration((value) => value + 1);
		}
		return () => {
			if (settled) disposed.current = true;
		};
	}, []);
	return generation;
}

function LexicalInputAria({ label }: { label: string }) {
	const [editor] = useLexicalComposerContext();
	useEffect(
		() =>
			editor.registerRootListener((root) => {
				root?.setAttribute("aria-label", label);
				root?.setAttribute("data-qa-id", "kilo-composer-input");
			}),
		[editor, label],
	);
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

// With an empty composer and a non-empty queue, the send key steers the top
// queued message (same as its "Send now" button). Must run at CRITICAL
// priority: the built-in HIGH handler preventDefaults Enter on an empty
// composer when idle, so a LOW-priority handler would never see the idle case.
function SteerQueueOnEnterPlugin({ disabled, sendKey }: { disabled: boolean; sendKey: SendKey }) {
	const [editor] = useLexicalComposerContext();
	const aui = useAui();
	const canQueue = useAuiState((s) => s.thread.capabilities.queue);

	useEffect(() => {
		return editor.registerCommand(
			KEY_ENTER_COMMAND,
			(event) => {
				if (disabled || !canQueue || !isSendEnter(event, sendKey)) return false;
				const composer = aui.composer.getState();
				if (!composer.isEmpty || composer.queue.length === 0) return false;
				event.preventDefault();
				aui.composer.queueItem({ index: 0 }).move({ lane: "steer", insertAfter: null });
				return true;
			},
			COMMAND_PRIORITY_CRITICAL,
		);
	}, [aui, canQueue, disabled, editor, sendKey]);

	return null;
}

function EnterOverridePlugin({ onEnter, sendKey }: { onEnter: () => boolean; sendKey: SendKey }) {
	const [editor] = useLexicalComposerContext();
	const latest = useLatestRef(onEnter);
	useEffect(
		() =>
			editor.registerCommand(
				KEY_ENTER_COMMAND,
				(event) => {
					if (!isSendEnter(event, sendKey) || !latest.current()) return false;
					event.preventDefault();
					return true;
				},
				COMMAND_PRIORITY_CRITICAL,
			),
		[editor, latest, sendKey],
	);
	return null;
}

function QueueEnterWhileRunningPlugin({ sendKey }: { sendKey: SendKey }) {
	const [editor] = useLexicalComposerContext();
	const aui = useAui();
	const canQueue = useAuiState((s) => s.thread.capabilities.queue);

	useEffect(() => {
		return editor.registerCommand(
			KEY_ENTER_COMMAND,
			(event) => {
				if (!isSendEnter(event, sendKey)) return false;
				if (!canQueue || !aui.thread.getState().isRunning) return false;
				if (aui.composer.getState().isEmpty) return false;
				event.preventDefault();
				aui.composer.send();
				return true;
			},
			COMMAND_PRIORITY_LOW,
		);
	}, [aui, canQueue, editor, sendKey]);

	return null;
}
