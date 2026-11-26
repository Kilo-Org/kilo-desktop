import { KILO_DESKTOP_METADATA_KEY } from "../../../contracts/chat-stamp.js";
import { writeManagedKiloPlugin } from "../managed-kilo-plugins.js";

/** The plugin's directory in Desktop's managed plugin directory. */
export const CHAT_SYSTEM_PLUGIN_NAME = "anaconda-desktop-chat-system";

/**
 * Generates the dependency-free Kilo v2 server plugin that gives the model a
 * chat's per-prompt system text. Kilo v2 prompts carry no `system`, so
 * kilo.core (`Chats.prompt`) and kilo.chat (`prompt-options.ts`) put it on the
 * user message's metadata (`metadata["kilo-desktop"].system`, see
 * `promptMetadata`), which Kilo shows to no model. The plugin's session
 * `context` hook, which runs before each of the agent loop's model requests
 * (not titles or compactions), appends the system text of the latest user
 * message Desktop stamped to the request's system prompt: each prompt brings
 * its current context, as v1's per-prompt `system` did, and earlier prompts'
 * context isn't repeated. Kilo's own user-role messages (synthetic notices
 * such as a subagent's result) carry no stamp, so they don't hide it.
 */
export function createChatSystemPluginSource(): string {
	return `const METADATA_KEY = ${JSON.stringify(KILO_DESKTOP_METADATA_KEY)};

const stampOf = (message) => {
  const stamp = message.role === "user" ? message.metadata?.[METADATA_KEY] : undefined;
  return stamp && typeof stamp === "object" ? stamp : undefined;
};

export default {
  id: "anaconda-desktop-chat-system",
  setup: async (ctx) => {
    await ctx.session.hook("context", (event) => {
      const stamped = event.messages.findLast((message) => stampOf(message) !== undefined);
      const text = stamped ? stampOf(stamped).system : undefined;
      if (typeof text === "string" && text.trim()) event.system.push({ type: "text", text });
    });
  },
};
`;
}

export async function reconcileChatSystemPlugin(pluginDirectory: string): Promise<void> {
	await writeManagedKiloPlugin(
		pluginDirectory,
		CHAT_SYSTEM_PLUGIN_NAME,
		createChatSystemPluginSource(),
	);
}
