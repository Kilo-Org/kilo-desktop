import { expect, vi } from "vitest";
import { page } from "vitest/browser";
import { z } from "zod";

import {
	defineDomainObject,
	defineExtensionPoint,
	defineObjectType,
	KernelFlagSource,
	KernelIdentityProvider,
	KernelLinkedAccount,
	type AccountInput,
	type AccountSource,
	type FlagSource,
	type FlagValue,
} from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import {
	contributor,
	renderShell,
	type GuestPlugin,
	type ShellHostOptions,
} from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../plugin.json";
import { DEVELOPER_DEFINITIONS, DEVELOPER_FLAG } from "../contracts";
import { developerWebEntry } from "../web";

export { contributor };

export const developer: GuestPlugin = {
	manifest,
	definitions: DEVELOPER_DEFINITIONS,
	web: developerWebEntry,
};

/** Forces the developer flag on, as the e2e build's flag overrides do. */
export const DEVELOPER_ON: ShellHostOptions = { flags: { [DEVELOPER_FLAG]: true } };

/**
 * A flag source in main whose values a test sets, as LaunchDarkly would
 * answer them for the identity.
 */
export function flagSource(initial: Record<string, FlagValue> = {}) {
	let values: Record<string, FlagValue> = initial;
	const listeners = new Set<() => void>();
	const source: FlagSource = {
		values: () => values,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		identify: () => {},
	};
	const plugin: GuestPlugin = {
		manifest: testManifest("acme.flags", {
			contributes: { extensions: { "kernel/flag-source": [{ id: "source" }] } },
		}),
		main: {
			activate: (sdk) => {
				sdk.extensions.implement(KernelFlagSource, "source", source);
			},
		},
	};
	return {
		plugin,
		set(next: Record<string, FlagValue>) {
			values = next;
			for (const listener of listeners) listener();
		},
	};
}

/** Plugins in main that describe the primary account and a linked one. */
export function accounts(primary: AccountInput | null, linked?: AccountInput) {
	const source = (account: AccountInput | null): AccountSource => ({
		current: () => account,
		subscribe: () => () => {},
	});
	return {
		manifest: testManifest("acme.accounts", {
			contributes: {
				extensions: {
					"kernel/identity-provider": [{ id: "primary" }],
					...(linked ? { "kernel/linked-account": [{ id: "linked" }] } : {}),
				},
			},
		}),
		main: {
			activate: (sdk) => {
				sdk.extensions.implement(KernelIdentityProvider, "primary", source(primary));
				if (linked) {
					sdk.extensions.implement(KernelLinkedAccount, "linked", source(linked));
				}
			},
		},
	} satisfies GuestPlugin;
}

export const ToolPanel = defineExtensionPoint({
	id: "acme.server/tool-panel",
	kind: "additive",
	description: "Panels for agent tools.",
});

export const ServerStatus = defineDomainObject({
	id: "acme.server/status",
	home: "renderer",
	description: "Whether the agent server is up.",
	state: z.object({ up: z.boolean() }),
	methods: {},
});

export const Job = defineObjectType({ id: "acme.server/job", description: "One agent job." });

export const Jobs = defineDomainObject({
	id: "acme.server/jobs",
	home: "main",
	description: "The agent's jobs.",
	state: z.object({ jobs: z.record(z.string(), z.object({ title: z.string() })) }),
	lookup: (state, id) => state.jobs[id],
	objectType: Job,
});

/** A plugin that offers a point, domain objects and an object type, contributes to several, runs a service and uses permissions. */
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
				"kernel/flag": [{ id: "agent-beta", description: "The agent's beta features." }],
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
				domainObjects: [
					{ id: "status", home: "renderer" },
					{ id: "jobs", home: "main", objectType: "acme.server/job" },
				],
				objectTypes: [{ id: "job", description: "One agent job." }],
				permissions: { host: ["os"] },
				contextKeys: [{ id: "busy", description: "True while the agent works." }],
				requires: {
					"kilo.shell/navigation": "optional",
					"kilo.shell/settings-section": "required",
				},
			},
		),
		definitions: {
			extensionPoints: [ToolPanel],
			domainObjects: [ServerStatus, Jobs],
			objectTypes: [Job],
		},
	};
}

export async function openDiagnostics(
	plugins: readonly GuestPlugin[] = [agentServer()],
	options: ShellHostOptions = {},
) {
	await page.viewport(1280, 800);
	const host = await renderShell([developer, ...plugins], {
		...options,
		flags: { [DEVELOPER_FLAG]: true, ...options.flags },
	});
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
