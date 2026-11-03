import { definePlugin, type PluginSdk } from "@kilo-desktop/kernel";

import { provideAutoApprove, type AutoApproveOptions } from "./auto-approve";
import { provideGatewayModels } from "./gateway-models";
import {
	implementHtmlRenderTool,
	provideHtmlPages,
	registerMcpAppHost,
	type WriteNewFile,
} from "./html-render";
import { provideModelPreferences } from "./model-preferences";

export interface ChatMainOptions extends AutoApproveOptions {
	/** Reads origin's saved model preferences (parsed JSON, null when none), adopted once. */
	readonly originModelPreferences?: (sdk: PluginSdk) => Promise<unknown>;
	readonly now?: () => number;
	/** Creates saved HTML pages (node fs in the app); saving is unavailable without it. */
	readonly writeNewFile?: WriteNewFile;
}

/**
 * kilo.chat's main entry: what every window's composers share — the model
 * pickers' remembered choices, the Kilo Gateway's model catalog, and the
 * approval mode with the auto-approver that answers for every chat — and the
 * agent's `html_render` tool, saving its pages and the `mcp-app` host that
 * frames them and MCP App widgets.
 */
export function createChatMainEntry(options: ChatMainOptions = {}) {
	return definePlugin({
		async activate(sdk) {
			provideGatewayModels(sdk, options.now);
			provideAutoApprove(sdk, options);
			provideHtmlPages(sdk, options.writeNewFile);
			implementHtmlRenderTool(sdk);
			registerMcpAppHost(sdk);
			const readOrigin = options.originModelPreferences;
			await provideModelPreferences(sdk, readOrigin && (() => readOrigin(sdk)));
		},
	});
}
