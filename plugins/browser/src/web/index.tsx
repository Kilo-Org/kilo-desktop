import type { SDK } from "@kilo-desktop/feature-sdk";
import { EarthIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { registerBrowserWebMcpTools } from "./browser-webmcp-tools.js";
import { openBrowserLocalFile } from "./open-browser-tab.js";

/**
 * Lets other features show a workspace file (an HTML page) in a Browser tab.
 * Consumers declare this shape locally; the host only serves files inside a
 * registered workspace.
 */
export interface BrowserViewerCapability extends Record<string, unknown> {
	openFile(options: { readonly sessionId: string; readonly path: string }): {
		readonly error?: string;
	};
}

export function BrowserIcon({ className, iconKey }: { className?: string; iconKey?: string }) {
	const [failedIcon, setFailedIcon] = useState<string>();
	useEffect(() => setFailedIcon(undefined), [iconKey]);
	return iconKey && failedIcon !== iconKey ? (
		<img
			src={iconKey}
			alt=""
			className={className}
			draggable={false}
			onError={() => setFailedIcon(iconKey)}
		/>
	) : (
		<EarthIcon className={className} />
	);
}

export { BrowserMarkdownExtension } from "./BrowserMarkdownExtension.js";
export { BrowserView } from "./BrowserView.js";

export function webRegister(sdk: SDK): void {
	registerBrowserWebMcpTools(sdk);
	sdk.plugins.expose("browserViewer", {
		openFile: ({ sessionId, path }) => {
			const result = openBrowserLocalFile(sdk, sessionId, path);
			return "error" in result ? { error: result.error } : {};
		},
	} satisfies BrowserViewerCapability);
}
