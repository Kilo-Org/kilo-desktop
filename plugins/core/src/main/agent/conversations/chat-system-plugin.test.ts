import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
	CHAT_SYSTEM_PLUGIN_NAME,
	createChatSystemPluginSource,
	reconcileChatSystemPlugin,
} from "./chat-system-plugin.js";
import { promptMetadata } from "./index.js";

type ContextEvent = {
	system: { type: "text"; text: string }[];
	messages: { role: string; metadata?: Record<string, unknown> }[];
};

/** Runs the generated plugin's setup and returns its session `context` hook. */
async function contextHook(): Promise<(event: ContextEvent) => void> {
	const source = createChatSystemPluginSource();
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
	const plugin = (
		(await import(moduleUrl)) as { default: { id: string; setup(ctx: unknown): Promise<void> } }
	).default;
	let hook: ((event: ContextEvent) => void) | undefined;
	await plugin.setup({
		session: {
			hook: async (name: string, callback: (event: ContextEvent) => void) => {
				if (name === "context") hook = callback;
			},
		},
	});
	expect(plugin.id).toBe("anaconda-desktop-chat-system");
	return hook!;
}

const base = () => [{ type: "text" as const, text: "Kilo's own system prompt" }];

describe("the chat system prompt plugin", () => {
	it("adds the latest prompt's system text to the model request's system prompt", async () => {
		const hook = await contextHook();
		const event: ContextEvent = {
			system: base(),
			messages: [
				{ role: "user", metadata: promptMetadata("Earlier workspace context") },
				{ role: "assistant" },
				{ role: "user", metadata: promptMetadata("Current workspace context") },
				{ role: "assistant" },
				{ role: "tool" },
			],
		};

		hook(event);

		expect(event.system).toEqual([...base(), { type: "text", text: "Current workspace context" }]);
	});

	it("isn't hidden by Kilo's own user-role messages, which carry no stamp", async () => {
		const hook = await contextHook();
		const event: ContextEvent = {
			system: base(),
			messages: [{ role: "user", metadata: promptMetadata("Context") }, { role: "user" }],
		};

		hook(event);

		expect(event.system.at(-1)).toEqual({ type: "text", text: "Context" });
	});

	it("adds nothing for a chat without system text", async () => {
		const hook = await contextHook();
		const event: ContextEvent = {
			system: base(),
			messages: [
				{ role: "user" },
				{ role: "user", metadata: { "kilo-desktop": { system: "  " } } },
				{ role: "assistant", metadata: promptMetadata("not a prompt") },
			],
		};

		hook(event);

		expect(event.system).toEqual(base());
	});

	it("writes the plugin as a directory in Desktop's managed plugin directory", async () => {
		const pluginDirectory = path.join(
			await mkdtemp(path.join(os.tmpdir(), "chat-system-plugin-")),
			"kilo-plugins",
		);

		await reconcileChatSystemPlugin(pluginDirectory);

		await expect(
			readFile(path.join(pluginDirectory, CHAT_SYSTEM_PLUGIN_NAME, "index.js"), "utf8"),
		).resolves.toBe(createChatSystemPluginSource());
	});
});
