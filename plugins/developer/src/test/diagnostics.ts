import { expect, vi } from "vitest";
import { page } from "vitest/browser";
import { z } from "zod";

import { defineDomain, defineExtensionPoint, type PluginSdk } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import {
	renderShell,
	type GuestPlugin,
	type ShellHostOptions,
} from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../plugin.json";
import { DEVELOPER_DEFINITIONS, DEVELOPER_FLAG } from "../contracts";
import { developerWebEntry } from "../web";

export const developer: GuestPlugin = {
	manifest,
	definitions: DEVELOPER_DEFINITIONS,
	web: developerWebEntry,
};

/** A stand-in for kilo.flags with the developer flag on or off. */
export function developerFlag(on: boolean): GuestPlugin {
	return {
		manifest: testManifest("kilo.flags", { contextKeys: [{ id: "flag:*", scope: "global" }] }),
		main: {
			activate: (sdk) => {
				sdk.context.set(`flag:${DEVELOPER_FLAG}`, on);
			},
		},
	};
}

/** A renderer plugin that contributes to points through its manifest. */
export function contributor(
	id: string,
	extensions: Record<string, unknown[]>,
	activate: (sdk: PluginSdk) => void = () => {},
	extra: Record<string, unknown> = {},
): GuestPlugin {
	return {
		manifest: testManifest(id, { contributes: { extensions }, ...extra }),
		web: { activate },
	};
}

export const ToolPanel = defineExtensionPoint({
	id: "acme.server/tool-panel",
	kind: "additive",
	description: "Panels for agent tools.",
});

export const ServerStatus = defineDomain({
	id: "acme.server/status",
	home: "renderer",
	description: "Whether the agent server is up.",
	state: z.object({ up: z.boolean() }),
	methods: {},
});

/** A plugin that offers a point and a domain, contributes to several, runs a service and uses permissions. */
export function agentServer(): GuestPlugin {
	return {
		...contributor(
			"acme.server",
			{
				"kernel/service": [
					{ id: "daemon", title: "Agent server", kind: "daemon", startOn: "activation" },
					{
						id: "index",
						title: "Index files",
						kind: "task",
						startOn: "first-use",
						restart: { policy: "never" },
					},
				],
				"kilo.shell/settings-section": [
					{ id: "models", title: "Models" },
					{ id: "tools", title: "Tools" },
					{ id: "safe", title: "Safe mode", priority: 5, when: { all: ["kernel/safeMode"] } },
				],
				"acme.missing/panel": [{ id: "extra" }],
			},
			() => {},
			{
				description: "Runs the agent server.",
				extensionPoints: [{ id: "tool-panel", kind: "additive" }],
				domains: [{ id: "status", home: "renderer" }],
				permissions: { host: ["os"] },
				contextKeys: [{ id: "busy" }],
				requires: {
					"kilo.shell/navigation": "optional",
					"kilo.shell/settings-section": "required",
				},
			},
		),
		definitions: { extensionPoints: [ToolPanel], domains: [ServerStatus] },
	};
}

export async function openDiagnostics(
	plugins: readonly GuestPlugin[] = [agentServer()],
	options: ShellHostOptions = {},
) {
	await page.viewport(1280, 800);
	const host = await renderShell([developer, developerFlag(true), ...plugins], options);
	window.location.hash = "#/settings/diagnostics";
	await expect.element(page.getByTestId("diagnostics-settings")).toBeVisible();
	return host;
}

/** Host options that load and save the plugins turned off. */
export function pluginsHost(disabled: string[] = []) {
	const saveDisabled = vi.fn();
	const relaunch = vi.fn();
	return {
		saveDisabled,
		relaunch,
		options: { plugins: { loadDisabled: () => disabled, saveDisabled }, relaunch },
	};
}

export function rowIds(panelTestId: string) {
	return [...page.getByTestId(panelTestId).element().children].map((row) =>
		row.getAttribute("data-qa-id"),
	);
}
