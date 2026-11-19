import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS, toolWireName } from "@kilo-desktop/plugin-core/contracts";
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json";
import { LOCAL_INFERENCE_DEFINITIONS } from "@kilo-desktop/plugin-local-inference/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import {
	BRIDGE_SERVICE_KEY,
	Conda,
	CONDA_CHAT_CONFIG,
	CONDA_LLAMA_RUNTIME,
	CONDA_SETUP_TOOL,
	CONDA_TOOL_IDS,
	CondaRuntime,
	ENVIRONMENTS_DEFINITIONS,
	ENVIRONMENTS_FLAG,
	ENVIRONMENTS_PLUGIN_ID,
	ENVIRONMENTS_SETTINGS_SECTION,
	ENVIRONMENTS_TELEMETRY_EVENTS,
	MUTATING_CONDA_TOOL_IDS,
	PACKAGE_INSTALL_DEEP_LINK,
	PERMISSION_RENDERERS,
	POLICY_CARD_TOOL_IDS,
	TOOL_RENDERERS,
} from "./index";

describe("kilo.environments manifest", () => {
	const discover = () =>
		discoverPlugins(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
				{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
				// kilo.chat requires kilo.work-sessions.
				{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
				{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
				{ manifest: localInferenceManifest, definitions: LOCAL_INFERENCE_DEFINITIONS },
				{ manifest, definitions: ENVIRONMENTS_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts and those of the kernel, kilo.core, kilo.shell, kilo.chat and kilo.local-inference", () => {
		expect(discover().issues).toEqual([]);
	});

	const contributions = (point: `${string}/${string}`) =>
		discover().plugins.find((plugin) => plugin.manifest.id === ENVIRONMENTS_PLUGIN_ID)!.manifest
			.contributes!.extensions![point]!;

	const key = (id: string) => `${ENVIRONMENTS_PLUGIN_ID}/${id}`;

	it("keeps origin's domain objects, service, settings section and flag, and declares its events", () => {
		expect([Conda.id, CondaRuntime.id]).toEqual([
			"kilo.environments/conda",
			"kilo.environments/conda-runtime",
		]);
		expect(contributions("kernel/service").map((entry) => key(String(entry.id)))).toEqual([
			BRIDGE_SERVICE_KEY,
		]);
		expect(contributions("kilo.shell/settings-section")).toEqual([
			expect.objectContaining({
				id: ENVIRONMENTS_SETTINGS_SECTION,
				when: { all: [`kernel/flag:${ENVIRONMENTS_FLAG}`] },
			}),
		]);
		expect(contributions("kernel/flag")).toEqual([
			expect.objectContaining({ id: ENVIRONMENTS_FLAG, default: false }),
		]);
		expect(contributions("kernel/telemetry-event").map((entry) => entry.id)).toEqual(
			Object.values(ENVIRONMENTS_TELEMETRY_EVENTS),
		);
	});

	it("routes anaconda.org's install links to the settings page", () => {
		expect(contributions("kilo.shell/deep-link")).toEqual([
			{
				id: PACKAGE_INSTALL_DEEP_LINK.id,
				host: PACKAGE_INSTALL_DEEP_LINK.host,
				path: `/settings/${ENVIRONMENTS_SETTINGS_SECTION}`,
				pathParam: PACKAGE_INSTALL_DEEP_LINK.pathParam,
				query: [...PACKAGE_INSTALL_DEEP_LINK.query],
			},
		]);
	});

	it("keeps origin's tool wire names, offered to external apps as origin's default did", () => {
		const tools = contributions("kilo.core/tool");
		expect(tools.map((entry) => entry.id)).toEqual([CONDA_SETUP_TOOL, ...CONDA_TOOL_IDS]);
		for (const tool of tools) expect(tool).toMatchObject({ external: true, requiresSignIn: true });
		for (const id of MUTATING_CONDA_TOOL_IDS) {
			expect(tools.find((tool) => tool.id === id)).toMatchObject({ approval: "ask" });
		}
		expect(toolWireName(key("conda.envs.list"))).toBe("desktop_environments_conda_envs_list");
		expect(toolWireName(key(CONDA_SETUP_TOOL))).toBe("desktop_environments_conda_setup_open");
	});

	it("configures chats, gives llama.cpp to the Local Model Server and details conda requests", () => {
		expect(contributions("kilo.core/chat-config").map((entry) => entry.id)).toEqual([
			CONDA_CHAT_CONFIG,
		]);
		expect(contributions("kilo.local-inference/llama-runtime")).toEqual([
			expect.objectContaining({ id: CONDA_LLAMA_RUNTIME, title: "Conda" }),
		]);
		expect(contributions("kilo.chat/permission-renderer")).toEqual([
			{ id: PERMISSION_RENDERERS.condaTools, tools: MUTATING_CONDA_TOOL_IDS.map(key) },
			{ id: PERMISSION_RENDERERS.condaCli },
			{ id: PERMISSION_RENDERERS.localFileAnswers },
		]);
	});

	it("draws the failures of the conda tools that resolve packages as policy cards in the chat", () => {
		expect(contributions("kilo.chat/tool-renderer")).toEqual([
			{ id: TOOL_RENDERERS.condaPolicy, tools: POLICY_CARD_TOOL_IDS.map(key) },
		]);
		expect(POLICY_CARD_TOOL_IDS).toEqual([
			"conda.envs.create",
			"conda.envs.clone",
			"conda.packages.install",
			"conda.packages.update",
			"conda.packages.remove",
			"conda.repodata.find",
		]);
	});
});
