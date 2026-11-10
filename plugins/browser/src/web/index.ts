import {
	definePlugin,
	KernelCommand,
	KernelOs,
	KernelTelemetry,
	type PluginSdk,
} from "@kilo-desktop/kernel";
import { MarkdownExtension } from "@kilo-desktop/plugin-chat/contracts";
import { PaneKind, Panes, WorkSessionsWindow } from "@kilo-desktop/plugin-work-sessions/contracts";

import { BROWSER_PANE_KIND } from "../contracts/index.js";
import { BrowserIcon } from "./BrowserIcon.js";
import { createBrowserMarkdownExtension } from "./BrowserMarkdownExtension.js";
import { BrowserPane } from "./BrowserPane.js";

export { BrowserIcon } from "./BrowserIcon.js";
export { BrowserPane } from "./BrowserPane.js";

/**
 * Shows the open work session's last Browser pane, or opens one (origin's
 * Open Browser), through the window: a popped-out pane's window comes
 * forward and the open is reported like one from "+".
 */
export async function openBrowser(sdk: PluginSdk): Promise<void> {
	await sdk.domainObjects.get(WorkSessionsWindow)?.methods.openPane({ kind: BROWSER_PANE_KIND });
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
				panes: () => sdk.domainObjects.get(Panes),
				os: () => sdk.domainObjects.get(KernelOs),
				telemetry: () => sdk.domainObjects.get(KernelTelemetry),
			}),
		);
		sdk.extensions.implement(KernelCommand, "open-browser", () => openBrowser(sdk));
	},
});
