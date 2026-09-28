import type { SDK } from "@kilo-desktop/feature-sdk";

import { normalizeBrowserUrl } from "../main/browser-url.js";
import type { ChatRightPanelCapabilities } from "./chat-right-panel.js";

const BROWSER_TAB_DEFINITION = { id: "browser.browser", title: "Browser" } as const;

export type OpenBrowserTabResult =
	| { readonly instanceId: string; readonly url: string }
	| { readonly error: string };

/**
 * Shows `rawUrl` in a Browser tab of the given chat's pane layout, focusing a
 * tab already on that URL instead of duplicating it. Only http(s) URLs pass,
 * using the same normalization as the address bar.
 */
export function openBrowserTab(sdk: SDK, sessionId: string, rawUrl: string): OpenBrowserTabResult {
	let url: string;
	try {
		url = normalizeBrowserUrl(rawUrl);
	} catch (cause) {
		return { error: cause instanceof Error ? cause.message : "Enter a valid URL." };
	}
	const panel = sdk.plugins.get<Partial<ChatRightPanelCapabilities>>("kilo-ui")?.chatRightPanel;
	if (!panel) {
		return { error: "The chat pane layout is unavailable. The chat UI plugin may not be loaded." };
	}

	const existing = panel
		.listTabs(sessionId)
		.find((tab) => tab.definitionId === BROWSER_TAB_DEFINITION.id && tab.metadata?.["url"] === url);
	if (existing) {
		panel.activateTab(sessionId, existing.instanceId);
		return { instanceId: existing.instanceId, url };
	}
	const tab = panel.openContributedTab(sessionId, BROWSER_TAB_DEFINITION, {
		title: new URL(url).host,
		metadata: { url },
	});
	return { instanceId: tab.instanceId, url };
}
