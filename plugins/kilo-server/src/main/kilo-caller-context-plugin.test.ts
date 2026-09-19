import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
	KILO_CALLER_CONTEXT_KEY,
	KILO_CALLER_CONTEXT_PLUGIN_FILENAME,
	createKiloCallerContextPluginSource,
	reconcileKiloCallerContextPlugin,
} from "./kilo-caller-context-plugin.js";

type BeforeHook = (
	input: { tool: string; sessionID: string; callID: string },
	output: { args: Record<string, unknown> },
) => Promise<void>;

describe("Kilo caller context plugin", () => {
	it("stamps Desktop MCP notebook calls with authoritative session and call ids", async () => {
		const source = createKiloCallerContextPluginSource();
		const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
		const pluginModule = (await import(moduleUrl)) as {
			AnacondaDesktopCallerContext: () => Promise<{ "tool.execute.before": BeforeHook }>;
		};
		const hooks = await pluginModule.AnacondaDesktopCallerContext();
		const output = { args: { title: "analysis" } };

		await hooks["tool.execute.before"]?.(
			{ tool: "desktop_notebook_open", sessionID: "session-a", callID: "call-a" },
			output,
		);

		expect(output.args).toEqual({
			title: "analysis",
			[KILO_CALLER_CONTEXT_KEY]: {
				version: 1,
				sessionId: "session-a",
				callId: "call-a",
			},
		});
	});

	it("does not change tools outside Desktop's MCP namespace", async () => {
		const source = createKiloCallerContextPluginSource();
		const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
		const pluginModule = (await import(moduleUrl)) as {
			AnacondaDesktopCallerContext: () => Promise<{ "tool.execute.before": BeforeHook }>;
		};
		const hooks = await pluginModule.AnacondaDesktopCallerContext();
		const output = { args: { path: "/tmp/file" } };

		await hooks["tool.execute.before"]?.(
			{ tool: "read", sessionID: "session-a", callID: "call-a" },
			output,
		);

		expect(output.args).toEqual({ path: "/tmp/file" });
	});

	it("installs the plugin in Kilo's auto-loaded plugin directory", async () => {
		const configDirectory = await mkdtemp(path.join(os.tmpdir(), "kilo-caller-plugin-"));

		await reconcileKiloCallerContextPlugin(configDirectory);

		await expect(
			readFile(path.join(configDirectory, "plugin", KILO_CALLER_CONTEXT_PLUGIN_FILENAME), "utf8"),
		).resolves.toBe(createKiloCallerContextPluginSource());
	});
});
