import { mkdir } from "node:fs/promises";
import path from "node:path";

import { writeFile as atomicWriteFile } from "atomically";

export const KILO_CALLER_CONTEXT_KEY = "__anacondaDesktopKiloCaller";
export const KILO_CALLER_CONTEXT_PLUGIN_FILENAME = "anaconda-desktop-caller-context.js";

/**
 * Generates the dependency-free Kilo plugin installed in Desktop's isolated
 * config directory. Kilo is the authority for session/call identity; the
 * generic MCP transport does not expose either value to WebMCP producers.
 */
export function createKiloCallerContextPluginSource(): string {
	return `const CONTEXT_KEY = ${JSON.stringify(KILO_CALLER_CONTEXT_KEY)};
const DESKTOP_TOOL_PREFIX = "desktop_";

export const AnacondaDesktopCallerContext = async () => ({
  "tool.execute.before": async (input, output) => {
    if (!input.tool.startsWith(DESKTOP_TOOL_PREFIX)) return;
    output.args[CONTEXT_KEY] = {
      version: 1,
      sessionId: input.sessionID,
      callId: input.callID,
    };
  },
});

export default { id: "anaconda-desktop-caller-context", server: AnacondaDesktopCallerContext };
`;
}

export async function reconcileKiloCallerContextPlugin(configDirectory: string): Promise<void> {
	const pluginDirectory = path.join(configDirectory, "plugin");
	await mkdir(pluginDirectory, { recursive: true });
	await atomicWriteFile(
		path.join(pluginDirectory, KILO_CALLER_CONTEXT_PLUGIN_FILENAME),
		createKiloCallerContextPluginSource(),
		{ encoding: "utf8" },
	);
}
