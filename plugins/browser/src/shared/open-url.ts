import type { DomainObjectHandle } from "@kilo-desktop/kernel";
import type { Pane, Panes } from "@kilo-desktop/plugin-work-sessions/contracts";

import { normalizeWebUrl, URL_OBJECT_TYPE } from "../contracts/index.js";

export interface OpenedUrl {
	readonly pane: Pane;
	readonly url: string;
}

/**
 * Shows a web page in its work session through kilo.work-sessions' openers:
 * a pane already on the page is shown instead of opening another. Throws for
 * anything but http(s), or when no opener takes web pages.
 */
export async function openUrl(
	panes: DomainObjectHandle<typeof Panes>,
	workSessionId: string,
	rawUrl: string,
): Promise<OpenedUrl> {
	const url = normalizeWebUrl(rawUrl);
	const pane = await panes.methods.openObject({
		workSessionId,
		ref: { type: URL_OBJECT_TYPE, id: url },
	});
	if (!pane) throw new Error("No pane in this session opens web pages.");
	return { pane, url };
}
