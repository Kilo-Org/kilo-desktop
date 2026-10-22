import type { SDK } from "@kilo-desktop/feature-sdk";

import { absoluteWorkspaceFilePath } from "./notebook-viewer.js";

/** The browser plugin's viewer, declared locally (no import across features). */
interface BrowserViewerCapability {
	openFile(options: { readonly sessionId: string; readonly path: string }): {
		readonly error?: string;
	};
}

interface BrowserCapabilities extends Record<string, unknown> {
	readonly browserViewer: BrowserViewerCapability;
}

export function isHtmlFile(relativePath: string): boolean {
	return /\.html?$/iu.test(relativePath);
}

/**
 * Shows an HTML file rendered in a Browser tab. `false` when the Browser
 * plugin is unavailable or refuses it, so the caller can show the source.
 */
export function openHtmlInBrowser(
	sdk: SDK,
	options: {
		readonly sessionId: string;
		readonly workspaceDirectory: string;
		readonly relativePath: string;
	},
): boolean {
	const viewer = sdk.plugins.get<BrowserCapabilities>("browser")?.browserViewer;
	if (!viewer) return false;
	const result = viewer.openFile({
		sessionId: options.sessionId,
		path: absoluteWorkspaceFilePath(options.workspaceDirectory, options.relativePath),
	});
	return !result.error;
}
