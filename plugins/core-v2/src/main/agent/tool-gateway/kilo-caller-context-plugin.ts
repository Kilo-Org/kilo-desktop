import { mkdir } from "node:fs/promises";
import path from "node:path";

import { writeFile as atomicWriteFile } from "atomically";

export const KILO_CALLER_CONTEXT_KEY = "__anacondaDesktopKiloCaller";
/** The plugin's folder in Desktop's managed plugin directory (Kilo v2 loads plugins as folders). */
export const KILO_CALLER_CONTEXT_PLUGIN_DIRECTORY = "anaconda-desktop-caller-context";

/**
 * Generates the dependency-free Kilo v2 plugin installed in Desktop's managed
 * plugin directory. Kilo is the authority for session/call identity; the
 * generic MCP transport does not pass either value to the tool gateway, so
 * the plugin adds them to every `desktop_*` call's input in v2's
 * `tool` `execute.before` hook.
 */
export function createKiloCallerContextPluginSource(): string {
	return `const CONTEXT_KEY = ${JSON.stringify(KILO_CALLER_CONTEXT_KEY)};
const DESKTOP_TOOL_PREFIX = "desktop_";

export default {
  id: "anaconda-desktop-caller-context",
  setup: async (ctx) => {
    await ctx.tool.hook("execute.before", (event) => {
      if (!event.tool.startsWith(DESKTOP_TOOL_PREFIX)) return;
      const input = event.input && typeof event.input === "object" ? event.input : {};
      event.input = {
        ...input,
        [CONTEXT_KEY]: { version: 1, sessionId: event.sessionID, callId: event.id },
      };
    });
  },
};
`;
}

export async function reconcileKiloCallerContextPlugin(pluginDirectory: string): Promise<void> {
	const directory = path.join(pluginDirectory, KILO_CALLER_CONTEXT_PLUGIN_DIRECTORY);
	await mkdir(directory, { recursive: true });
	await atomicWriteFile(path.join(directory, "index.js"), createKiloCallerContextPluginSource(), {
		encoding: "utf8",
	});
}
