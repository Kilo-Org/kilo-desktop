import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
	KILO_CALLER_CONTEXT_KEY,
	KILO_CALLER_CONTEXT_PLUGIN_NAME,
	createKiloCallerContextPluginSource,
	reconcileKiloCallerContextPlugin,
} from "./kilo-caller-context-plugin.js";

type BeforeEvent = { tool: string; sessionID: string; id: string; input: unknown };

/** Runs the generated plugin's setup and returns its `execute.before` tool hook. */
async function beforeHook(): Promise<(event: BeforeEvent) => Promise<void> | void> {
	const source = createKiloCallerContextPluginSource();
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
	const plugin = (
		(await import(moduleUrl)) as {
			default: { id: string; setup(ctx: unknown): Promise<void> };
		}
	).default;
	let hook: ((event: BeforeEvent) => void) | undefined;
	await plugin.setup({
		tool: {
			hook: async (name: string, callback: (event: BeforeEvent) => void) => {
				if (name === "execute.before") hook = callback;
			},
		},
	});
	expect(plugin.id).toBe("anaconda-desktop-caller-context");
	return hook!;
}

describe("Kilo caller context plugin", () => {
	it("stamps calls to Desktop's MCP tools with Kilo's session and call ids", async () => {
		const hook = await beforeHook();
		const event: BeforeEvent = {
			tool: "desktop_notebook_open",
			sessionID: "session-a",
			id: "call-a",
			input: { title: "analysis" },
		};

		await hook(event);

		expect(event.input).toEqual({
			title: "analysis",
			[KILO_CALLER_CONTEXT_KEY]: { version: 1, sessionId: "session-a", callId: "call-a" },
		});
	});

	it("leaves other tools, and inputs that aren't objects, alone", async () => {
		const hook = await beforeHook();
		const read: BeforeEvent = { tool: "read", sessionID: "s", id: "c", input: { path: "/tmp/f" } };
		const odd: BeforeEvent = { tool: "desktop_odd", sessionID: "s", id: "c", input: ["x"] };

		await hook(read);
		await hook(odd);

		expect(read.input).toEqual({ path: "/tmp/f" });
		expect(odd.input).toEqual(["x"]);
	});

	it("writes the plugin as a directory in Desktop's managed plugin directory", async () => {
		const pluginDirectory = path.join(
			await mkdtemp(path.join(os.tmpdir(), "kilo-caller-plugin-")),
			"kilo-plugins",
		);

		await reconcileKiloCallerContextPlugin(pluginDirectory);

		await expect(
			readFile(path.join(pluginDirectory, KILO_CALLER_CONTEXT_PLUGIN_NAME, "index.js"), "utf8"),
		).resolves.toBe(createKiloCallerContextPluginSource());
	});
});
