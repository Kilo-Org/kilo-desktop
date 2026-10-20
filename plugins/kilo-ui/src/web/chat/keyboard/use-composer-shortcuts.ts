import { useCommand } from "@kilo-desktop/sdk-react";

const KILO_UI = "kilo-ui";
const COMPOSER = "Composer";
const COMPOSER_INPUT = '[data-slot="aui_composer-shell"] [contenteditable]';

/**
 * Registered once per page, not per composer: with several agent panes, a
 * shared id would go to whichever composer mounted last.
 */
export function useComposerShortcuts(revealComposer: () => void): void {
	useCommand(KILO_UI, {
		id: "focus-composer",
		label: "Focus the message input",
		group: COMPOSER,
		keybinding: { mac: "Mod+L", default: "Ctrl+Shift+L" },
		order: 0,
		handler: () => {
			revealComposer();
			requestAnimationFrame(() => document.querySelector<HTMLElement>(COMPOSER_INPUT)?.focus());
		},
	});
	useCommand(KILO_UI, {
		id: "send-message",
		label: "Send message",
		group: COMPOSER,
		keybinding: "Enter",
		handledLocally: true,
		order: 10,
		handler: () => undefined,
	});
	useCommand(KILO_UI, {
		id: "new-line",
		label: "New line",
		group: COMPOSER,
		keybinding: "Shift+Enter",
		handledLocally: true,
		order: 11,
		handler: () => undefined,
	});
	useCommand(KILO_UI, {
		id: "cycle-agent",
		label: "Change agent mode",
		group: COMPOSER,
		keybinding: "Shift+Tab",
		handledLocally: true,
		order: 12,
		handler: () => undefined,
	});
}
