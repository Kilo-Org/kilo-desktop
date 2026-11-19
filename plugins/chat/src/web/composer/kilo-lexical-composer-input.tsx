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
	type CommandListenerPriority,
} from "lexical";
import type { Unstable_DirectiveFormatter } from "@assistant-ui/react";
import {
	type CSSProperties,
	type FC,
	type KeyboardEvent as ReactKeyboardEvent,
	type Ref,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";

import { KiloDirectiveChip } from "./directive-chip";

type KiloLexicalComposerInputProps = {
	ref?: Ref<HTMLDivElement>;
	/** Writes and reads chips (slash commands, mentions) in the composer's text. */
	formatter: Unstable_DirectiveFormatter;
	placeholder?: string;
	disabled?: boolean;
	cancelOnEscape?: boolean;
	submitMode?: "enter" | "ctrlEnter" | "none";
	onKeyDown?: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
	/** Takes a plain Enter before sending or queueing does, when it returns true. */
	onEnter?: () => boolean;
	/**
	 * Takes a plain Enter the `/` and mention menus left alone, in place of
	 * sending; pair it with `submitMode="none"`.
	 */
	onSubmitEnter?: () => void;
	/** Inline sizing, e.g. a `maxHeight` replacing the default auto-grow cap. */
	style?: CSSProperties | undefined;
	/** The input's accessible name. */
	label?: string;
	qaId?: string;
	autoFocus?: boolean;
};

/**
 * The composer's rich input (Lexical): chips for slash commands and mentions,
 * Enter to send and Shift+Enter for a new line, pasted files as attachments,
 * and Enter on an empty composer to send the next queued prompt now.
 */
export const KiloLexicalComposerInput: FC<KiloLexicalComposerInputProps> = ({
	ref,
	formatter,
	placeholder = "Send a message or / for commands…",
	disabled = false,
	cancelOnEscape,
	submitMode,
	onKeyDown,
	onEnter,
	onSubmitEnter,
	style,
	label = "Message input",
	qaId = "kilo-composer-input",
	autoFocus,
}) => {
	const editorGeneration = useEditorGeneration();
	// Cached on `ref` and `label`, so a re-render doesn't detach and re-attach it (and set the label again).
	const attachInput = (node: HTMLDivElement | null) => {
		if (typeof ref === "function") ref(node);
		else if (ref) ref.current = node;
		node?.querySelector("[contenteditable]")?.setAttribute("aria-label", label);
	};
	return (
		<LexicalComposerInput
			key={editorGeneration}
			ref={attachInput}
			formatter={formatter}
			directiveChip={KiloDirectiveChip}
			placeholder={placeholder}
			cancelOnEscape={cancelOnEscape}
			submitMode={submitMode}
			aria-label={label}
			onKeyDown={onKeyDown}
			className={cn(
				"aui-composer-input caret-foreground max-h-32 w-full bg-transparent px-1 pt-0 pb-1 text-sm",
				disabled && "pointer-events-none cursor-not-allowed opacity-60",
			)}
			style={style}
		>
			<LexicalInputAria label={label} qaId={qaId} />
			<AttachmentPastePlugin />
			<SteerQueueOnEnterPlugin disabled={disabled} submitMode={submitMode} />
			<QueueEnterWhileRunningPlugin />
			{/* CRITICAL: ahead of the built-in handler, the queue and sending. */}
			{onEnter ? (
				<EnterHandlerPlugin onEnter={onEnter} priority={COMMAND_PRIORITY_CRITICAL} />
			) : null}
			{/* LOW: after the built-in HIGH handler, which gives the `/` and mention
			    menus first refusal (and sends nothing with submitMode "none"), and
			    before plain text's EDITOR-priority newline. */}
			{onSubmitEnter ? (
				<EnterHandlerPlugin
					onEnter={() => {
						onSubmitEnter();
						return true;
					}}
					priority={COMMAND_PRIORITY_LOW}
				/>
			) : null}
			{autoFocus ? <FocusAtEndPlugin /> : null}
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

function LexicalInputAria({ label, qaId }: { label: string; qaId: string }) {
	const [editor] = useLexicalComposerContext();
	useEffect(
		() =>
			editor.registerRootListener((root) => {
				root?.setAttribute("aria-label", label);
				root?.setAttribute("data-qa-id", qaId);
			}),
		[editor, label, qaId],
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

const isPlainEnter = (event: KeyboardEvent | null): event is KeyboardEvent =>
	!!event && !event.shiftKey && !event.isComposing && !event.ctrlKey && !event.metaKey;

/**
 * Whether Enter can steer or queue prompts here: the thread's composer when
 * its thread has a queue, not a message's edit composer (which has none).
 * `isEditing` can't tell them apart: the thread's composer is always editing.
 */
const useCanQueueOnEnter = () =>
	useAuiState((s) => s.thread.capabilities.queue && s.composer.type !== "edit");

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
	const canQueue = useCanQueueOnEnter();

	useEffect(() => {
		return editor.registerCommand(
			KEY_ENTER_COMMAND,
			(event) => {
				if (disabled || submitMode !== "enter" || !canQueue) return false;
				if (!isPlainEnter(event)) return false;
				const composer = aui.composer.getState();
				if (!composer.isEmpty || composer.queue.length === 0) return false;
				event.preventDefault();
				aui.composer.queueItem({ index: 0 }).move({ lane: "steer", insertAfter: null });
				return true;
			},
			COMMAND_PRIORITY_CRITICAL,
		);
	}, [aui, canQueue, disabled, editor, submitMode]);

	return null;
}

/**
 * Focuses the input with the caret after its text once it is shown. Waits a
 * frame: the text arrives from the composer's state after mount, and the
 * click that opened the input may still be settling focus.
 */
function FocusAtEndPlugin() {
	const [editor] = useLexicalComposerContext();
	useEffect(() => {
		const frame = requestAnimationFrame(() => {
			editor.focus(undefined, { defaultSelection: "rootEnd" });
			editor.getRootElement()?.focus({ preventScroll: true });
		});
		return () => cancelAnimationFrame(frame);
	}, [editor]);
	return null;
}

/** Takes a plain Enter at `priority` when `onEnter` returns true. */
function EnterHandlerPlugin({
	onEnter,
	priority,
}: {
	onEnter: () => boolean;
	priority: CommandListenerPriority;
}) {
	const [editor] = useLexicalComposerContext();
	const latest = useLatestRef(onEnter);
	useEffect(
		() =>
			editor.registerCommand(
				KEY_ENTER_COMMAND,
				(event) => {
					if (!isPlainEnter(event) || !latest.current()) return false;
					event.preventDefault();
					return true;
				},
				priority,
			),
		[editor, latest, priority],
	);
	return null;
}

function QueueEnterWhileRunningPlugin() {
	const [editor] = useLexicalComposerContext();
	const aui = useAui();
	const canQueue = useCanQueueOnEnter();

	useEffect(() => {
		return editor.registerCommand(
			KEY_ENTER_COMMAND,
			(event) => {
				if (!isPlainEnter(event)) return false;
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
