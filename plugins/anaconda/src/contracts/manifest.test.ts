import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import localInferenceManifest from "@kilo-desktop/plugin-local-inference/plugin.json";
import {
	LOCAL_INFERENCE_DEFINITIONS,
	MODEL_CATALOG_FLAG,
} from "@kilo-desktop/plugin-local-inference/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import {
	ANACONDA_ACCOUNT_PANEL,
	ANACONDA_DEFINITIONS,
	ANACONDA_LINKED_ACCOUNT,
	ANACONDA_MODEL_CATALOG,
	ANACONDA_PLUGIN_ID,
	ANACONDA_SIGNED_IN_KEY,
	ANACONDA_TELEMETRY_EVENTS,
	AnacondaAccount,
	LOCAL_MODEL_CATALOG_FLAG,
} from "./index";

describe("kilo.anaconda manifest", () => {
	const discover = (withOthers = true) =>
		discoverPlugins(
			[
				...(withOthers
					? [
							{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
							{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
							// kilo.local-inference requires kilo.chat, which requires kilo.work-sessions.
							{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
							{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
							{ manifest: localInferenceManifest, definitions: LOCAL_INFERENCE_DEFINITIONS },
						]
					: []),
				{ manifest, definitions: ANACONDA_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts and those of the kernel, kilo.shell and kilo.local-inference", () => {
		expect(discover().issues).toEqual([]);
	});

	it("needs nothing but the kernel (contributions to absent plugins are only warned about)", () => {
		expect(
			discover(false).issues.filter((issue) => issue.code !== "absent-extension-point-owner"),
		).toEqual([]);
	});

	const contributions = (point: `${string}/${string}`) =>
		discover().plugins.find((plugin) => plugin.manifest.id === ANACONDA_PLUGIN_ID)!.manifest
			.contributes!.extensions![point]!;

	it("renames origin's kilo.anaconda-account ids to kilo.anaconda", () => {
		expect(manifest.id).toBe("kilo.anaconda");
		expect(AnacondaAccount.id).toBe("kilo.anaconda/account");
		expect(ANACONDA_SIGNED_IN_KEY).toBe(`${ANACONDA_PLUGIN_ID}/anacondaSignedIn`);
	});

	it("keeps origin's account panel behind kilo.local-inference's flag, and origin's events", () => {
		expect(LOCAL_MODEL_CATALOG_FLAG).toBe(MODEL_CATALOG_FLAG);
		expect(contributions("kilo.shell/account-panel")).toEqual([
			{
				id: ANACONDA_ACCOUNT_PANEL,
				priority: 90,
				when: { all: [`kernel/flag:${LOCAL_MODEL_CATALOG_FLAG}`] },
			},
		]);
		expect(contributions("kernel/telemetry-event")).toEqual([
			{ id: ANACONDA_TELEMETRY_EVENTS.loggedIn, name: "Anaconda Logged In" },
			{ id: ANACONDA_TELEMETRY_EVENTS.loggedOut, name: "Anaconda Logged Out" },
		]);
	});

	it("links the account to the identity and contributes Anaconda's model catalog", () => {
		expect(contributions("kernel/linked-account")).toEqual([{ id: ANACONDA_LINKED_ACCOUNT }]);
		expect(contributions("kilo.local-inference/model-catalog")).toEqual([
			{ id: ANACONDA_MODEL_CATALOG, title: "Anaconda" },
		]);
	});
});
