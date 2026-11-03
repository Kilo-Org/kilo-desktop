import { afterEach, describe, expect, it, vi } from "vitest";
import { page } from "vitest/browser";

import type { DomainProvider, PluginEntry, PluginSdk } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { renderShell } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../../plugin.json";
import { AGENT_DEFINITIONS, AgentConfig, AgentServer, WorkStyleOnboarding } from "../../contracts";
import { agentWebEntry } from "../index";
import { resetWorkStyleSession } from "./work-style-step";

type Permission = Record<string, unknown>;

/** The user's global Kilo config, as the server's config API sees it. */
const globalConfig = vi.hoisted(() => ({
	permission: undefined as Record<string, unknown> | undefined,
	updates: [] as Record<string, unknown>[],
	failNext: undefined as Error | undefined,
}));

vi.mock("../providers/kilo-client", () => ({
	createKiloDirectoryClient: vi.fn(() => ({
		global: {
			dispose: vi.fn(async () => undefined),
			config: {
				get: vi.fn(async () => ({ data: { permission: globalConfig.permission } })),
				update: vi.fn(async ({ config }: { config: { permission: Permission } }) => {
					if (globalConfig.failNext) {
						const error = globalConfig.failNext;
						globalConfig.failNext = undefined;
						throw error;
					}
					globalConfig.updates.push(config);
					globalConfig.permission = { ...globalConfig.permission, ...config.permission };
					for (const [key, value] of Object.entries(globalConfig.permission)) {
						if (value === null) delete globalConfig.permission[key];
					}
					return { data: {} };
				}),
			},
		},
	})),
}));

function fakeAgentMain(): PluginEntry {
	return {
		activate(sdk) {
			const server: DomainProvider<typeof AgentServer> = sdk.domains.provide(AgentServer, {
				initialState: { status: "ready", version: "7.8.17" },
				methods: {
					connect: () => ({
						baseUrl: "http://127.0.0.1:4096",
						username: "kilo",
						password: "secret",
						version: server.state.version ?? "7.8.17",
						globalDirectory: "/runtime",
					}),
					restart: () => {},
					disposeInstance: () => {},
				},
			});
			sdk.domains.provide(AgentConfig, {
				initialState: {},
				methods: {
					userConfigFile: () => ({ path: "/home/.config/kilo/kilo.jsonc", exists: true }),
					storedApiKey: () => ({ key: null }),
					presentEnv: () => ({ names: [] }),
				},
			});
		},
	};
}

/** A window plugin listening to the step's events, as kilo.telemetry does. */
function workStyleListener() {
	const heard = vi.fn<(event: string, data: unknown) => void>();
	const plugin = {
		manifest: testManifest("test.listener", {
			requires: { "kilo.agent/work-style-onboarding": "optional" },
		}),
		web: {
			activate(sdk: PluginSdk) {
				sdk.domains.track(WorkStyleOnboarding, {
					added: (onboarding) => {
						onboarding.on("shown", (data) => heard("shown", data));
						onboarding.on("selected", (data) => heard("selected", data));
					},
					removed: () => {},
				});
			},
		},
	};
	return { heard, plugin };
}

async function openWorkStyleStep(listener = workStyleListener()) {
	await renderShell(
		[
			{ manifest, definitions: AGENT_DEFINITIONS, main: fakeAgentMain(), web: agentWebEntry },
			listener.plugin,
		],
		{ desktop: true, onboarding: true },
	);
	await expect
		.element(page.getByRole("heading", { name: "Choose how you want to work" }))
		.toBeVisible();
}

const choice = (style: string) => page.getByTestId(`onboarding-work-style-${style}`);
const radio = (style: string) => choice(style).getByRole("radio");

afterEach(() => {
	globalConfig.permission = undefined;
	globalConfig.updates = [];
	globalConfig.failNext = undefined;
	resetWorkStyleSession();
});

describe("work-style onboarding events", () => {
	it("announces the step once when shown, and each choice the person continues with", async () => {
		const listener = workStyleListener();
		await openWorkStyleStep(listener);
		await vi.waitFor(() => expect(listener.heard).toHaveBeenCalledWith("shown", {}));

		await choice("human-in-the-loop").click();
		await page.getByTestId("onboarding-continue").click();
		await expect.element(page.getByRole("heading", { name: "You're all set" })).toBeVisible();

		expect(listener.heard.mock.calls).toEqual([
			["shown", {}],
			["selected", { style: "human-in-the-loop" }],
		]);
	});
});

describe("work-style onboarding step", () => {
	it("starts on High autonomy, which leaves the user's config alone", async () => {
		await openWorkStyleStep();

		await expect.element(radio("autonomous")).toBeChecked();
		await page.getByTestId("onboarding-continue").click();

		await expect.element(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
		expect(globalConfig.updates).toEqual([]);
	});

	it("warns before Review first replaces the user's own rules, then writes it", async () => {
		globalConfig.permission = { edit: "allow" };
		await openWorkStyleStep();

		await choice("human-in-the-loop").click();

		await expect.element(page.getByTestId("onboarding-work-style-existing")).toBeVisible();
		await page.getByTestId("onboarding-continue").click();
		await expect.element(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
		expect(globalConfig.updates).toHaveLength(1);
		expect(globalConfig.permission).not.toMatchObject({ edit: "allow" });
	});

	it("restores the replaced rules when switching back to High autonomy", async () => {
		globalConfig.permission = { edit: "allow" };
		await openWorkStyleStep();
		await choice("human-in-the-loop").click();
		await page.getByTestId("onboarding-continue").click();
		await expect.element(page.getByRole("heading", { name: "You're all set" })).toBeVisible();

		await page.getByTestId("onboarding-back").click();
		await choice("autonomous").click();
		await page.getByTestId("onboarding-continue").click();

		await expect.element(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
		expect(globalConfig.permission).toMatchObject({ edit: "allow" });
	});

	it("explains a failed save and offers to retry", async () => {
		globalConfig.failNext = new Error("Config is read-only.");
		await openWorkStyleStep();
		await choice("human-in-the-loop").click();

		await page.getByTestId("onboarding-continue").click();

		await expect.element(page.getByText("Config is read-only.")).toBeVisible();
		await expect.element(page.getByTestId("onboarding-continue")).toHaveAccessibleName("Retry");
		await page.getByTestId("onboarding-continue").click();
		await expect.element(page.getByRole("heading", { name: "You're all set" })).toBeVisible();
	});
});
