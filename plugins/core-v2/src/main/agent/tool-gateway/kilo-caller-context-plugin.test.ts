import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
	KILO_CALLER_CONTEXT_KEY,
	KILO_CALLER_CONTEXT_PLUGIN_DIRECTORY,
	createKiloCallerContextPluginSource,
	reconcileKiloCallerContextPlugin,
} from "./kilo-caller-context-plugin.js";

type BeforeEvent = { tool: string; sessionID: string; id: string; input: unknown };

/** Loads the generated v2 plugin module and runs its setup against a recording context. */
async function setUp() {
	const source = createKiloCallerContextPluginSource();
	const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
	const plugin = (await import(moduleUrl)) as {
		default: { id: string; setup(ctx: unknown): Promise<void> };
	};
	const hooks: Record<string, (event: BeforeEvent) => unknown> = {};
	await plugin.default.setup({
		tool: {
			hook: async (name: string, run: (event: BeforeEvent) => unknown) => {
				hooks[name] = run;
			},
		},
	});
	return { id: plugin.default.id, before: hooks["execute.before"]! };
}

describe("Kilo caller context plugin", () => {
	it("is a Kilo v2 plugin module that stamps Desktop MCP calls with the session and call ids", async () => {
		const { id, before } = await setUp();
		const event = {
			tool: "desktop_notebook_open",
			sessionID: "ses_a",
			id: "call_a",
			input: { title: "analysis" },
		};

		await before(event);

		expect(id).toBe("anaconda-desktop-caller-context");
		expect(event.input).toEqual({
			title: "analysis",
			[KILO_CALLER_CONTEXT_KEY]: { version: 1, sessionId: "ses_a", callId: "call_a" },
		});
	});

	it("does not change tools outside Desktop's MCP namespace", async () => {
		const { before } = await setUp();
		const event = { tool: "read", sessionID: "ses_a", id: "call_a", input: { path: "/tmp/file" } };

		await before(event);

		expect(event.input).toEqual({ path: "/tmp/file" });
	});

	it("writes the plugin as a folder in Desktop's managed plugin directory", async () => {
		const pluginDirectory = path.join(
			await mkdtemp(path.join(os.tmpdir(), "kilo-caller-plugin-")),
			"kilo-plugins",
		);

		await reconcileKiloCallerContextPlugin(pluginDirectory);

		await expect(
			readFile(
				path.join(pluginDirectory, KILO_CALLER_CONTEXT_PLUGIN_DIRECTORY, "index.js"),
				"utf8",
			),
		).resolves.toBe(createKiloCallerContextPluginSource());
	});
});
