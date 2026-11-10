/** kilo.chat's `kernel/command` keys. */
export const CHAT_COMMANDS = {
	/** Focuses the open work session's composer (opening its agent pane). */
	focusComposer: "kilo.chat/focus-composer",
	/** Shown in keyboard help only: the composer handles Enter itself. */
	sendMessage: "kilo.chat/send-message",
	/** Shown in keyboard help only: the composer handles Shift+Enter itself. */
	newLine: "kilo.chat/new-line",
	/** Shown in keyboard help only: the composer handles Shift+Tab itself. */
	cycleAgent: "kilo.chat/cycle-agent",
} as const;

/**
 * The `kernel/flag` behind the find bar in chat, plan and other panes
 * (`@kilo-desktop/ui`'s `FIND_BAR_FEATURE_FLAG`); kilo.chat declares it.
 */
export const FIND_BAR_FLAG = "searchbar-windows-panels";
