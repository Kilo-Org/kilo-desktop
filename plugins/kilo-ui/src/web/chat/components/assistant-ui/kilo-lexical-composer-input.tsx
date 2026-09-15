import { cn } from "@anaconda-agentic-desktop/ui/lib/utils";
import { useAui, useAuiState } from "@assistant-ui/react";
import { LexicalComposerInput, type DirectiveChipProps } from "@assistant-ui/react-lexical";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_LOW, KEY_ENTER_COMMAND } from "lexical";
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
				"aui-composer-input caret-foreground max-h-32 w-full bg-transparent px-2.5 py-1 text-sm",
				disabled && "pointer-events-none cursor-not-allowed opacity-60",
			)}
		>
			<LexicalInputAria label="Message input" />
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
