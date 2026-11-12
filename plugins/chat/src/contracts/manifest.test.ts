import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS, toolWireName } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import {
	AGENT_PANE_KIND,
	CHAT_COMMANDS,
	CHAT_DEFINITIONS,
	CHAT_PLUGIN_ID,
	COMPOSER_FOCUSED_KEY,
	FIND_BAR_FLAG,
	HTML_RENDER_TOOL_ID,
	HTML_RENDER_TOOL_NAME,
	MEDIA_PANE_KIND,
	PLAN_PANE_KIND,
	PROMPT_QUEUE_EDITING_FLAG,
	SUBAGENT_PANE_KIND,
} from "./index";

describe("kilo.chat manifest", () => {
	const discover = () =>
		discoverPlugins(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
				{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
				{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
				{ manifest, definitions: CHAT_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts, the kernel's, kilo.core's, kilo.shell's and kilo.work-sessions'", () => {
		expect(discover().issues).toEqual([]);
	});

	const contributions = (point: `${string}/${string}`) =>
		discover().plugins.find((plugin) => plugin.manifest.id === CHAT_PLUGIN_ID)!.manifest
			.contributes!.extensions![point]!;

	const keys = (point: `${string}/${string}`) =>
		contributions(point).map((entry) => `${CHAT_PLUGIN_ID}/${String(entry.id)}`);

	it("contributes the pane kinds, commands and flags its contracts name", () => {
		expect(keys("kilo.work-sessions/pane-kind")).toEqual([
			AGENT_PANE_KIND,
			PLAN_PANE_KIND,
			SUBAGENT_PANE_KIND,
			MEDIA_PANE_KIND,
		]);
		expect(keys("kernel/command")).toEqual(Object.values(CHAT_COMMANDS));
		expect(keys("kernel/flag")).toEqual([
			`${CHAT_PLUGIN_ID}/${PROMPT_QUEUE_EDITING_FLAG}`,
			`${CHAT_PLUGIN_ID}/${FIND_BAR_FLAG}`,
		]);
		expect(COMPOSER_FOCUSED_KEY).toBe(`${CHAT_PLUGIN_ID}/${manifest.contextKeys[0]!.id}`);
	});

	it("starts work sessions with the agent pane", () => {
		expect(contributions("kilo.work-sessions/work-session-starter")).toEqual([
			expect.objectContaining({ id: "composer", paneKind: AGENT_PANE_KIND }),
		]);
		expect(contributions("kilo.work-sessions/work-session-action")).toEqual([
			expect.objectContaining({ id: "agents", placement: "end" }),
		]);
	});

	it("names html_render as Kilo calls it", () => {
		expect(keys("kilo.core/tool")).toEqual([`${CHAT_PLUGIN_ID}/${HTML_RENDER_TOOL_ID}`]);
		expect(toolWireName(`${CHAT_PLUGIN_ID}/${HTML_RENDER_TOOL_ID}`)).toBe(HTML_RENDER_TOOL_NAME);
	});
});
