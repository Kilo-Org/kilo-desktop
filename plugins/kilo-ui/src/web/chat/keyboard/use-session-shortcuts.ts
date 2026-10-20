import { useCommand } from "@kilo-desktop/sdk-react";

import {
	adjacentId,
	idAtShortcutSlot,
	NUMBERED_SLOTS,
	type NumberedSlot,
} from "./numbered-shortcuts.js";

const KILO_UI = "kilo-ui";
const SESSIONS = "Sessions";
const SESSION_NUMBER_SERIES = {
	id: "session-number",
	label: "Go to session 1–9",
	modifierChoice: true,
};

export interface SessionShortcutActions {
	/** Session (thread) ids in visible sidebar order, archived excluded. */
	readonly sessionIds: readonly string[];
	readonly activeSessionId: string | undefined;
	readonly attentionSessionIds: readonly string[];
	readonly openSession: (sessionId: string) => void;
	readonly newSession: () => void;
	readonly togglePin: (sessionId: string) => void;
}

function useSlotCommand(
	slot: NumberedSlot,
	enabled: boolean,
	actions: SessionShortcutActions,
): void {
	useCommand(
		KILO_UI,
		{
			id: slot === 9 ? "session-last" : `session-${slot}`,
			label: slot === 9 ? "Go to last session" : `Go to session ${slot}`,
			group: SESSIONS,
			// ⌃1–9 on macOS; Ctrl+1–9 is already Mod+1–9 (tabs) elsewhere.
			keybinding: { mac: `Ctrl+${slot}`, default: `Alt+${slot}` },
			order: slot,
			configurable: false,
			series: SESSION_NUMBER_SERIES,
			handler: () => {
				const sessionId = idAtShortcutSlot(actions.sessionIds, slot);
				if (sessionId) actions.openSession(sessionId);
			},
		},
		enabled,
	);
}

/** Numbers follow the visible sidebar order, so ⌃N lands on the Nth row shown. */
export function useSessionShortcuts(enabled: boolean, actions: SessionShortcutActions): void {
	// NUMBERED_SLOTS is a constant tuple, so the hook order never changes.
	for (const slot of NUMBERED_SLOTS) useSlotCommand(slot, enabled, actions);

	const step = (delta: 1 | -1) => {
		const sessionId = adjacentId(actions.sessionIds, actions.activeSessionId, delta);
		if (sessionId) actions.openSession(sessionId);
	};
	useCommand(
		KILO_UI,
		{
			id: "next-session",
			label: "Next session",
			group: SESSIONS,
			keybinding: ["Ctrl+Tab", { mac: "Mod+Alt+ArrowDown", default: "Alt+ArrowDown" }],
			repeatable: true,
			order: 20,
			handler: () => step(1),
		},
		enabled,
	);
	useCommand(
		KILO_UI,
		{
			id: "previous-session",
			label: "Previous session",
			group: SESSIONS,
			keybinding: ["Ctrl+Shift+Tab", { mac: "Mod+Alt+ArrowUp", default: "Alt+ArrowUp" }],
			repeatable: true,
			order: 21,
			handler: () => step(-1),
		},
		enabled,
	);
	useCommand(
		KILO_UI,
		{
			id: "next-attention-session",
			label: "Go to next session that needs attention",
			group: SESSIONS,
			keybinding: { mac: "Mod+Alt+A", default: "Ctrl+Shift+A" },
			order: 22,
			handler: () => {
				const { attentionSessionIds, activeSessionId } = actions;
				const others = attentionSessionIds.filter((id) => id !== activeSessionId);
				if (others.length === 0) return;
				// Continue downward from the active row, wrapping to the top.
				const activeIndex = activeSessionId ? actions.sessionIds.indexOf(activeSessionId) : -1;
				const next =
					others.find((id) => actions.sessionIds.indexOf(id) > activeIndex) ?? others[0]!;
				actions.openSession(next);
			},
		},
		enabled,
	);
	useCommand(
		KILO_UI,
		{
			id: "new-session",
			label: "New session",
			group: SESSIONS,
			keybinding: [{ mac: "Mod+N", default: "Ctrl+Shift+N" }, "Mod+Shift+O"],
			order: 30,
			handler: actions.newSession,
		},
		enabled,
	);
	useCommand(
		KILO_UI,
		{
			id: "toggle-pin-session",
			label: "Pin or unpin session",
			group: SESSIONS,
			keybinding: { mac: "Mod+Alt+P", default: "Ctrl+Shift+P" },
			order: 31,
			handler: () => {
				if (actions.activeSessionId) actions.togglePin(actions.activeSessionId);
			},
		},
		enabled,
	);
}
