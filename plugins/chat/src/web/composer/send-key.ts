import {
	KernelKeybindings,
	parseChord,
	resolveKeybinding,
	serializeChord,
} from "@kilo-desktop/kernel";
import { useDomainObject, useDomainObjectState, useKernel } from "@kilo-desktop/kernel/web";

import { CHAT_COMMANDS } from "../../contracts";

/*
 * Which Enter sends a prompt: plain Enter, or Ctrl+Enter (Cmd+Enter on macOS)
 * with plain Enter for a new line. The choice is stored as the user's
 * keybinding overrides of the locally handled `send-message` and `new-line`
 * commands, so Settings → Shortcuts and the shortcuts list show the real keys
 * and "Reset all" brings back Enter.
 */

export type SendKey = "enter" | "ctrlEnter";

type EnterEvent = {
	readonly shiftKey: boolean;
	readonly ctrlKey: boolean;
	readonly metaKey: boolean;
	readonly isComposing?: boolean;
};

/** True for the Enter that sends; Shift+Enter is always a new line. Matches Ctrl or Cmd, as assistant-ui does. */
export function isSendEnter<T extends EnterEvent>(
	event: T | null | undefined,
	sendKey: SendKey,
): event is T {
	if (!event || event.shiftKey || event.isComposing) return false;
	return (event.ctrlKey || event.metaKey) === (sendKey === "ctrlEnter");
}

export function useSendKey(): SendKey {
	const override = useDomainObjectState(
		KernelKeybindings,
		(state) => state.overrides[CHAT_COMMANDS.sendMessage],
	);
	const chord = override ? parseChord(override) : null;
	return chord?.code === "Enter" && (chord.ctrl || chord.meta) ? "ctrlEnter" : "enter";
}

/** Sets the send key, or undefined while the keybindings are unavailable. */
export function useSetSendKey(): ((sendKey: SendKey) => void) | undefined {
	const { platform } = useKernel().keyboard;
	const keybindings = useDomainObject(KernelKeybindings);
	if (!keybindings) return undefined;
	return (sendKey) => {
		const { sendMessage, newLine } = CHAT_COMMANDS;
		if (sendKey === "enter") {
			void keybindings.methods.reset({ command: sendMessage });
			void keybindings.methods.reset({ command: newLine });
			return;
		}
		const modEnter = resolveKeybinding("Mod+Enter", platform);
		if (!modEnter) return;
		void keybindings.methods.setOverride({ command: sendMessage, chord: serializeChord(modEnter) });
		void keybindings.methods.setOverride({ command: newLine, chord: "Enter" });
	};
}
