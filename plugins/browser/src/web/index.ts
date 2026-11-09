import { definePlugin, KernelCommand, KernelShell, type PluginSdk } from "@kilo-desktop/kernel";
import { MarkdownExtension } from "@kilo-desktop/plugin-chat/contracts";
import { PaneKind, Panes } from "@kilo-desktop/plugin-sessions/contracts";
import { Telemetry } from "@kilo-desktop/plugin-telemetry/contracts";
import { Workbench } from "@kilo-desktop/plugin-workbench/contracts";

import { BROWSER_PANE_KIND } from "../contracts/index.js";
import { BrowserIcon } from "./BrowserIcon.js";
import { createBrowserMarkdownExtension } from "./BrowserMarkdownExtension.js";
import { BrowserPane } from "./BrowserPane.js";

export { BrowserIcon } from "./BrowserIcon.js";
export { BrowserPane } from "./BrowserPane.js";

/**
 * Shows the open session's last Browser pane, or opens one (origin's Open
 * Browser), through the workbench: a popped-out pane's window comes forward
 * and the open is reported like one from "+".
 */
export async function openBrowser(sdk: PluginSdk): Promise<void> {
	await sdk.domains.get(Workbench)?.methods.openPane({ kind: BROWSER_PANE_KIND });
}

/**
 * kilo.browser's renderer entry: the Browser pane kind (kept alive, its
 * guest embedded in the window), web links in the agent's replies and Open
 * Browser.
 */
export const browserWebEntry = definePlugin({
	activate(sdk) {
		sdk.extensions.implement(PaneKind, "browser", { component: BrowserPane, icon: BrowserIcon });
		sdk.extensions.implement(
			MarkdownExtension,
			"web-links",
			createBrowserMarkdownExtension({
				panes: () => sdk.domains.get(Panes),
				shell: () => sdk.domains.get(KernelShell),
				telemetry: () => sdk.domains.get(Telemetry),
			}),
		);
		sdk.extensions.implement(KernelCommand, "open-browser", () => openBrowser(sdk));
	},
});
