import { describe, expect, it } from "vitest";

import { discoverPlugins, KERNEL_CONTEXT_KEYS, KERNEL_DEFINITIONS } from "@kilo-desktop/kernel";
import chatManifest from "@kilo-desktop/plugin-chat/plugin.json";
import { CHAT_DEFINITIONS } from "@kilo-desktop/plugin-chat/contracts";
import coreManifest from "@kilo-desktop/plugin-core/plugin.json";
import { CORE_DEFINITIONS } from "@kilo-desktop/plugin-core/contracts";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import { SHELL_DEFINITIONS } from "@kilo-desktop/plugin-shell/contracts";
import workSessionsManifest from "@kilo-desktop/plugin-work-sessions/plugin.json";
import { WORK_SESSIONS_DEFINITIONS } from "@kilo-desktop/plugin-work-sessions/contracts";

import manifest from "../../plugin.json";
import {
	Marketplace,
	MARKETPLACE_DEFINITIONS,
	MARKETPLACE_PLUGIN_ID,
	MARKETPLACE_SETTINGS_SECTION,
	MARKETPLACE_TELEMETRY_EVENTS,
} from "./index";

describe("kilo.marketplace manifest", () => {
	const discover = () =>
		discoverPlugins(
			[
				{ manifest: coreManifest, definitions: CORE_DEFINITIONS },
				{ manifest: shellManifest, definitions: SHELL_DEFINITIONS },
				{ manifest: workSessionsManifest, definitions: WORK_SESSIONS_DEFINITIONS },
				{ manifest: chatManifest, definitions: CHAT_DEFINITIONS },
				{ manifest, definitions: MARKETPLACE_DEFINITIONS },
			],
			{ kernelDefinitions: KERNEL_DEFINITIONS, kernelContextKeys: KERNEL_CONTEXT_KEYS },
		);

	it("agrees with its contracts and those of the kernel, kilo.core, kilo.shell, kilo.work-sessions and kilo.chat", () => {
		expect(discover().issues).toEqual([]);
	});

	const contributions = (point: `${string}/${string}`) =>
		discover().plugins.find((plugin) => plugin.manifest.id === MARKETPLACE_PLUGIN_ID)!.manifest
			.contributes!.extensions![point]!;

	it("keeps origin's domain object, settings section and telemetry events", () => {
		expect(Marketplace.id).toBe("kilo.marketplace/marketplace");
		expect(contributions("kilo.shell/settings-section")).toEqual([
			expect.objectContaining({
				id: MARKETPLACE_SETTINGS_SECTION,
				title: "Agent Behavior",
				category: "kilo.shell/ai",
			}),
		]);
		expect(contributions("kernel/telemetry-event")).toEqual([
			{ id: MARKETPLACE_TELEMETRY_EVENTS.tabViewed, name: "Marketplace Tab Viewed" },
			{
				id: MARKETPLACE_TELEMETRY_EVENTS.installClicked,
				name: "Marketplace Install Button Clicked",
			},
			{ id: MARKETPLACE_TELEMETRY_EVENTS.itemInstalled, name: "Marketplace Item Installed" },
			{ id: MARKETPLACE_TELEMETRY_EVENTS.itemRemoved, name: "Marketplace Item Removed" },
		]);
	});
});
