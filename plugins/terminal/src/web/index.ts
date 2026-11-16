import { definePlugin, KernelCommand, type PluginSdk } from "@kilo-desktop/kernel";
import { PaneKind, Panes, WorkSessionsWindow } from "@kilo-desktop/plugin-work-sessions/contracts";

import { TERMINAL_PANE_KIND } from "../contracts";
import { clearFocusedTerminal } from "./terminal-focus";
import { TerminalIcon, TerminalView } from "./TerminalView";

export { TerminalIcon, TerminalView } from "./TerminalView";

/**
 * kilo.terminal's renderer entry: the terminal pane kind and its commands —
 * New terminal always adds one; Open terminal (Ctrl+`) shows the work
 * session's terminal, or opens one, through kilo.work-sessions' window as
 * origin's shortcut did.
 */
export const terminalWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(PaneKind, "terminal", { component: TerminalView, icon: TerminalIcon });
		sdk.extensions.implement(KernelCommand, "clear", clearFocusedTerminal);
		sdk.extensions.implement(KernelCommand, "new", () => openTerminal(sdk));
		sdk.extensions.implement(KernelCommand, "open", () =>
			sdk.domainObjects.get(WorkSessionsWindow)?.methods.openPane({ kind: TERMINAL_PANE_KIND }),
		);
	},
});

/** Opens a terminal pane in the work session this window has open. */
async function openTerminal(sdk: PluginSdk): Promise<void> {
	const workSessionId = sdk.domainObjects.get(WorkSessionsWindow)?.getState().activeWorkSessionId;
	if (!workSessionId) return;
	await sdk.domainObjects.get(Panes)?.methods.open({ workSessionId, kind: TERMINAL_PANE_KIND });
}
