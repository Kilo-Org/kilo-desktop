import type { DomainHandle } from "@kilo-desktop/kernel";
import type { Panes } from "@kilo-desktop/plugin-sessions/contracts";
import type { PaneLauncher } from "@kilo-desktop/plugin-workbench/contracts";

import { CHANGES_PANE_KIND } from "../../contracts/index.js";

/**
 * Shows the open session's Changes pane: through kilo.workbench when it is
 * here (it brings a popped-out pane's window forward and reports the open),
 * else straight through kilo.sessions (the singleton pane is activated).
 */
export async function showChanges(
	launcher: DomainHandle<typeof PaneLauncher> | null,
	panes: DomainHandle<typeof Panes> | null,
	sessionId: string,
): Promise<void> {
	if (launcher) await launcher.methods.openOrShow({ kind: CHANGES_PANE_KIND });
	else await panes?.methods.open({ sessionId, kind: CHANGES_PANE_KIND });
}
