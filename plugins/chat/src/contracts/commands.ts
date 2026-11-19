/** kilo.chat's `kernel/command` keys. */
export const CHAT_COMMANDS = {
	/** Focuses the open work session's composer (opening its agent pane). */
	focusComposer: "kilo.chat/focus-composer",
	/** Shown in keyboard help only: the composer handles it; Settings → Chat picks Enter or Ctrl/Cmd+Enter. */
	sendMessage: "kilo.chat/send-message",
	/** Shown in keyboard help only: the composer handles it; follows Settings → Chat. */
	newLine: "kilo.chat/new-line",
	/** Shown in keyboard help only: the composer handles Shift+Tab itself. */
	cycleAgent: "kilo.chat/cycle-agent",
	/**
	 * Summarizes a chat to free up its context; run from the `/` menu
	 * (`/compact`), given its `ClientSlashCommandContext`.
	 */
	compact: "kilo.chat/compact",
} as const;

/** kilo.chat's `kernel/telemetry-event` ids. */
export const CHAT_TELEMETRY_EVENTS = {
	/** A fork from a user message was attempted: `{ success, midTurn }`. */
	chatForked: "chat-forked",
} as const;
