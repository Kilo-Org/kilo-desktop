import { writeManagedKiloPlugin } from "../managed-kilo-plugins.js";

export const KILO_CALLER_CONTEXT_KEY = "__anacondaDesktopKiloCaller";
/** The plugin's directory in Desktop's managed plugin directory. */
export const KILO_CALLER_CONTEXT_PLUGIN_NAME = "anaconda-desktop-caller-context";

/**
 * Generates the dependency-free Kilo v2 server plugin installed in Desktop's
 * managed plugin directory. Kilo is the authority for session and call
 * identity, and the generic MCP transport passes neither to the tool gateway,
 * so an `execute.before` tool hook adds them to the arguments of every call to
 * Desktop's `desktop` MCP server (tools named `desktop_<tool>`). Kilo hands
 * the hook's `input` on to the tool, and the gateway lists the key in the
 * tools' schemas (`catalog-view.ts`), so Kilo's input validation keeps it.
 */
export function createKiloCallerContextPluginSource(): string {
	return `const CONTEXT_KEY = ${JSON.stringify(KILO_CALLER_CONTEXT_KEY)};
const DESKTOP_TOOL_PREFIX = "desktop_";

export default {
  id: "anaconda-desktop-caller-context",
  setup: async (ctx) => {
    await ctx.tool.hook("execute.before", (event) => {
      if (!event.tool.startsWith(DESKTOP_TOOL_PREFIX)) return;
      if (typeof event.input !== "object" || event.input === null || Array.isArray(event.input)) return;
      event.input = {
        ...event.input,
        [CONTEXT_KEY]: { version: 1, sessionId: event.sessionID, callId: event.id },
      };
    });
  },
};
`;
}

export async function reconcileKiloCallerContextPlugin(pluginDirectory: string): Promise<void> {
	await writeManagedKiloPlugin(
		pluginDirectory,
		KILO_CALLER_CONTEXT_PLUGIN_NAME,
		createKiloCallerContextPluginSource(),
	);
}
