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
	/**
	 * Summarizes a chat to free up its context; run from the `/` menu
	 * (`/compact`), given its `ClientSlashCommandContext`.
	 */
	compact: "kilo.chat/compact",
	/** Enters Focus on the active reply or plan, or exits it (⌘⇧F). */
	toggleFocus: "kilo.chat/toggle-focus",
	/** Shown in keyboard help only: Focus handles Escape itself. */
	exitFocus: "kilo.chat/exit-focus",
	/** Shown in keyboard help only: Focus handles ↑ ↓ itself. */
	focusMove: "kilo.chat/focus-move",
} as const;

/** kilo.chat's `kernel/telemetry-event` ids. */
export const CHAT_TELEMETRY_EVENTS = {
	/** A fork from a user message was attempted: `{ success, midTurn }`. */
	chatForked: "chat-forked",
	// Reading Mode's events; their fields are typed in web/reading/reading-telemetry.ts.
	focusEntered: "focus-entered",
	focusExited: "focus-exited",
	focusEntryFailed: "focus-entry-failed",
	readingControlOpened: "reading-control-opened",
	readingSettingChanged: "reading-setting-changed",
	focusRoundTrip: "focus-round-trip",
	focusExcerptUsedInPrompt: "focus-excerpt-used-in-prompt",
	savedItemAdded: "saved-item-added",
	savedItemRemoved: "saved-item-removed",
	savedToastAction: "saved-toast-action",
	selectionMenuUsed: "selection-menu-used",
	savedActionFailed: "saved-action-failed",
} as const;
