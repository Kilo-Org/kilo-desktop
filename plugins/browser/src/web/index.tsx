import type { SDK } from "@kilo-desktop/feature-sdk";
import { EarthIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { registerBrowserWebMcpTools } from "./browser-webmcp-tools.js";

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
}
