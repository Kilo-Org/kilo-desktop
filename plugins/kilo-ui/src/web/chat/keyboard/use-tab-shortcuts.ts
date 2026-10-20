import { useCommand } from "@kilo-desktop/sdk-react";

import {
	adjacentId,
	idAtShortcutSlot,
	NUMBERED_SLOTS,
	type NumberedSlot,
} from "./numbered-shortcuts.js";

const KILO_UI = "kilo-ui";
const TABS = "Tabs";
const TAB_NUMBER_SERIES = { id: "tab-number", label: "Go to tab 1–9", modifierChoice: true };

export const PANE_KIND_SHORTCUTS = [
	{ id: "open-files", definitionId: "files.files", label: "Open Files", keybinding: "Mod+Shift+E" },
	{
		id: "open-changes",
		definitionId: "git.changes",
		label: "Open Changes",
		keybinding: "Ctrl+Shift+G",
	},
	{
		id: "open-terminal",
		definitionId: "terminal.terminal",
		label: "Open Terminal",
		keybinding: "Ctrl+`",
	},
	{
		id: "open-browser",
		definitionId: "browser.browser",
		label: "Open Browser",
		keybinding: "Mod+Shift+B",
	},
] as const;

export interface TabShortcutActions {
	/** Tab ids in strip order across the whole session layout. */
	readonly paneIds: readonly string[];
	readonly activePaneId: string | undefined;
	readonly focusPane: (paneId: string) => void;
	readonly closePane: (paneId: string) => void;
	readonly openNewTabPicker: () => void;
	readonly openPaneKind: (definitionId: string) => void;
	readonly openNewGroupPicker: (position: "after" | "below") => void;
	readonly toggleCarousel: () => void;
	/** Pane kinds that can be opened; shortcuts for missing plugins stay unbound. */
	readonly availableDefinitionIds: readonly string[];
}

function slotLabel(slot: NumberedSlot): string {
	return slot === 9 ? "Go to last tab" : `Go to tab ${slot}`;
}

function useSlotCommand(slot: NumberedSlot, enabled: boolean, actions: TabShortcutActions): void {
	useCommand(
		KILO_UI,
		{
			id: slot === 9 ? "tab-last" : `tab-${slot}`,
			label: slotLabel(slot),
			group: TABS,
			keybinding: `Mod+${slot}`,
			order: slot,
			configurable: false,
			series: TAB_NUMBER_SERIES,
			handler: () => {
				const paneId = idAtShortcutSlot(actions.paneIds, slot);
				if (paneId) actions.focusPane(paneId);
			},
		},
		enabled,
	);
}

export function useTabShortcuts(enabled: boolean, actions: TabShortcutActions): void {
	// NUMBERED_SLOTS is a constant tuple, so the hook order never changes.
	for (const slot of NUMBERED_SLOTS) useSlotCommand(slot, enabled, actions);

	const step = (delta: 1 | -1) => {
		const paneId = adjacentId(actions.paneIds, actions.activePaneId, delta);
		if (paneId) actions.focusPane(paneId);
	};
	useCommand(
		KILO_UI,
		{
			id: "next-tab",
			label: "Next tab",
			group: TABS,
			keybinding: { mac: "Mod+Alt+ArrowRight", default: "Ctrl+PageDown" },
			repeatable: true,
			order: 20,
			handler: () => step(1),
		},
		enabled,
	);
	useCommand(
		KILO_UI,
		{
			id: "previous-tab",
			label: "Previous tab",
			group: TABS,
			keybinding: { mac: "Mod+Alt+ArrowLeft", default: "Ctrl+PageUp" },
			repeatable: true,
			order: 21,
			handler: () => step(-1),
		},
		enabled,
	);
	useCommand(
		KILO_UI,
		{
			id: "new-tab",
			label: "New tab",
			group: TABS,
			keybinding: { mac: "Mod+T", default: "Ctrl+Shift+T" },
			order: 30,
			handler: actions.openNewTabPicker,
		},
		enabled,
	);
	useCommand(
		KILO_UI,
		{
			id: "close-tab",
			label: "Close tab",
			group: TABS,
			keybinding: { mac: "Mod+W", default: "Ctrl+Shift+W" },
			order: 31,
			handler: () => {
				if (actions.activePaneId) actions.closePane(actions.activePaneId);
			},
		},
		enabled,
	);
	useCommand(
		KILO_UI,
		{
			id: "new-group-right",
			label: "New tab group to the right",
			group: TABS,
			// Plain Ctrl+\ is SIGQUIT in the terminal, so Windows/Linux adds Shift.
			keybinding: { mac: "Mod+\\", default: "Ctrl+Shift+\\" },
			order: 32,
			handler: () => actions.openNewGroupPicker("after"),
		},
		enabled,
	);
	useCommand(
		KILO_UI,
		{
			id: "new-group-below",
			label: "New tab group below",
			group: TABS,
			keybinding: { mac: "Alt+Mod+\\", default: "Ctrl+Alt+Shift+\\" },
			order: 33,
			handler: () => actions.openNewGroupPicker("below"),
		},
		enabled,
	);
	useCommand(
		KILO_UI,
		{
			id: "toggle-carousel",
			label: "Turn carousel on or off",
			group: TABS,
			keybinding: { mac: "Ctrl+Mod+C", default: "Ctrl+Alt+C" },
			order: 34,
			handler: actions.toggleCarousel,
		},
		enabled,
	);
	usePaneKindCommand(0, enabled, actions);
	usePaneKindCommand(1, enabled, actions);
	usePaneKindCommand(2, enabled, actions);
	usePaneKindCommand(3, enabled, actions);
}

function usePaneKindCommand(index: number, enabled: boolean, actions: TabShortcutActions): void {
	const shortcut = PANE_KIND_SHORTCUTS[index]!;
	const available = actions.availableDefinitionIds.includes(shortcut.definitionId);
	useCommand(
		KILO_UI,
		{
			id: shortcut.id,
			label: shortcut.label,
			group: TABS,
			keybinding: shortcut.keybinding,
			order: 40 + index,
			handler: () => actions.openPaneKind(shortcut.definitionId),
		},
		enabled && available,
	);
}
