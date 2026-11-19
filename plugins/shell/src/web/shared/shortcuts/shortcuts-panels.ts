import { useExtensions, useKernel } from "@kilo-desktop/kernel/web";

import { ShortcutsPanel, type ShortcutsListRow } from "../../../contracts";

/** Commands the shortcuts panels edit themselves, so Settings' list leaves them out. */
export function useClaimedCommands(): ReadonlySet<string> {
	return new Set(useExtensions(ShortcutsPanel).flatMap((panel) => panel.metadata.commands));
}

/**
 * The ⌘/ rows the panels draw for their claimed commands, keyed by the
 * command each row takes the place of. A row may only stand for commands its
 * panel claims; a panel whose `listRows` throws draws none, so its commands
 * fall back to one row each.
 */
export function usePanelListRows(
	overrides: Readonly<Record<string, string | null>>,
): ReadonlyMap<string, ShortcutsListRow> {
	const kernel = useKernel();
	const rows = new Map<string, ShortcutsListRow>();
	for (const panel of useExtensions(ShortcutsPanel)) {
		const claimed = new Set(panel.metadata.commands);
		try {
			const listed = panel.implementation?.listRows?.({
				platform: kernel.keyboard.platform,
				overrides,
			});
			for (const row of listed ?? []) {
				if (row.commands.length === 0 || !row.commands.every((key) => claimed.has(key))) continue;
				for (const key of row.commands) rows.set(key, row);
			}
		} catch (error) {
			kernel.kernelSdk.logger.error(
				`Shortcuts panel "${panel.key}" could not list its rows`,
				error,
			);
		}
	}
	return rows;
}
