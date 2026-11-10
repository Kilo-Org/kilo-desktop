import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS, toolWireName } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import {
	IMPORT_SERVICE_KEY,
	LlamaRuntime,
	LOCAL_AI_PROVIDER_ID,
	LOCAL_INFERENCE_DEFINITIONS,
	LOCAL_INFERENCE_PLUGIN_ID,
	LOCAL_INFERENCE_TELEMETRY_EVENTS,
	LOCAL_MODEL_SERVER_CONTRIBUTION,
	LOCAL_MODEL_SERVER_SETTINGS_SECTION,
	LocalModels,
	MODEL_CATALOG_FLAG,
	MODEL_LOADING_STATUS_ITEM,
	ModelCatalogPoint,
	ModelServer,
	OPEN_SETTINGS_TOOL,
	ROUTER_SERVICE_KEY,
} from "./index";

describe("kilo.local-inference manifest", () => {
	const discover = () =>
		discoverPlugins(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
				{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
				// kilo.chat requires kilo.work-sessions.
				{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
				{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
				{ manifest, definitions: LOCAL_INFERENCE_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts and those of the kernel, kilo.core, kilo.shell and kilo.chat", () => {
		expect(discover().issues).toEqual([]);
	});

	const contributions = (point: `${string}/${string}`) =>
		discover().plugins.find((plugin) => plugin.manifest.id === LOCAL_INFERENCE_PLUGIN_ID)!.manifest
			.contributes!.extensions![point]!;

	const keys = (point: `${string}/${string}`) =>
		contributions(point).map((entry) => `${LOCAL_INFERENCE_PLUGIN_ID}/${String(entry.id)}`);

	it("offers its installed models, the server and the catalog and runtime extension points", () => {
		expect(LocalModels.id).toBe("kilo.local-inference/local-models");
		expect(ModelServer.id).toBe("kilo.local-inference/model-server");
		expect(ModelCatalogPoint.id).toBe("kilo.local-inference/model-catalog");
		expect(LlamaRuntime.id).toBe("kilo.local-inference/llama-runtime");
	});

	it("keeps origin's services, AI provider, settings section, deep link, flag and events", () => {
		expect(keys("kernel/service")).toEqual([ROUTER_SERVICE_KEY, IMPORT_SERVICE_KEY]);
		expect(contributions("kilo.core/ai-provider")).toEqual([
			{ id: LOCAL_MODEL_SERVER_CONTRIBUTION, aiProviderId: LOCAL_AI_PROVIDER_ID },
		]);
		expect(contributions("kilo.chat/model-source")).toEqual([
			expect.objectContaining({
				id: LOCAL_MODEL_SERVER_CONTRIBUTION,
				aiProviderId: LOCAL_AI_PROVIDER_ID,
				settingsSection: LOCAL_MODEL_SERVER_SETTINGS_SECTION,
			}),
		]);
		expect(contributions("kilo.shell/settings-section").map((entry) => entry.id)).toEqual([
			LOCAL_MODEL_SERVER_SETTINGS_SECTION,
		]);
		expect(contributions("kilo.shell/deep-link")).toEqual([
			expect.objectContaining({
				host: "model-catalog",
				path: "/settings/local-model-server",
				pathParam: "catalogModel",
			}),
		]);
		expect(contributions("kilo.shell/status-bar-item")).toEqual([
			expect.objectContaining({ id: MODEL_LOADING_STATUS_ITEM, kind: "view" }),
		]);
		expect(contributions("kernel/flag")).toEqual([
			expect.objectContaining({ id: MODEL_CATALOG_FLAG, default: false }),
		]);
		expect(contributions("kernel/telemetry-event").map((entry) => entry.id)).toEqual(
			Object.values(LOCAL_INFERENCE_TELEMETRY_EVENTS),
		);
	});

	it("keeps origin's agent tool and wire name, offered to external apps as origin's default did", () => {
		expect(contributions("kilo.core/tool")).toEqual([
			expect.objectContaining({ id: OPEN_SETTINGS_TOOL, readOnly: true, external: true }),
		]);
		expect(toolWireName(`${LOCAL_INFERENCE_PLUGIN_ID}/${OPEN_SETTINGS_TOOL}`)).toBe(
			"desktop_local_inference_settings_open",
		);
	});
});
