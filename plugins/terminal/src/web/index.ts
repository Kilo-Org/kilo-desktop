import { definePlugin, KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";
import { PaneKind, Panes } from "@kilo-desktop/plugin-sessions/contracts";
import { Navigator, PaneLauncher } from "@kilo-desktop/plugin-workbench/contracts";

import { TERMINAL_PANE_KIND } from "../contracts";
import { clearFocusedTerminal } from "./terminal-focus";
import { TerminalIcon, TerminalView } from "./TerminalView";

export { TerminalIcon, TerminalView } from "./TerminalView";

/**
 * kilo.terminal's renderer entry: the terminal pane kind and its commands —
 * New terminal always adds one; Open terminal (Ctrl+`) shows the session's
 * terminal, or opens one, through kilo.workbench as origin's shortcut did.
 */
export const terminalWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(PaneKind, "terminal", { component: TerminalView, icon: TerminalIcon });
		sdk.extensions.implement(KernelCommand, "clear", clearFocusedTerminal);
		sdk.extensions.implement(KernelCommand, "new", () => openTerminal(sdk));
		sdk.extensions.implement(KernelCommand, "open", () =>
			sdk.domains.get(PaneLauncher)?.methods.openOrShow({ kind: TERMINAL_PANE_KIND }),
		);
	},
});

/** Opens a terminal pane in the session this window has open. */
async function openTerminal(sdk: PluginSdk): Promise<void> {
	const sessionId = sdk.domains.get(Navigator)?.getState().activeSessionId;
	if (!sessionId) return;
	await sdk.domains.get(Panes)?.methods.open({ sessionId, kind: TERMINAL_PANE_KIND });
}
