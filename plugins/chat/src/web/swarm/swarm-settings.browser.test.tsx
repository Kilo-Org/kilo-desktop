import { beforeEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { KernelError, type DomainObjectProvider, type PluginSdk } from "@kilo-desktop/kernel";
import { Swarm } from "@kilo-desktop/plugin-core/contracts";
import { Navigation } from "@kilo-desktop/plugin-shell/contracts";
import { renderShell } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../../plugin.json";
import { CHAT_DEFINITIONS } from "../../contracts";
import { DEFAULT_SWARM_PREFERENCES, useSwarmPreferences } from "./swarm-preferences";
import { implementSwarmSettings, SWARM_SETTINGS_SECTION } from "./SwarmSettings";

const enabledSwitch = () => page.getByTestId("swarm-board-enabled");
const shelfSwitch = () => page.getByTestId("swarm-board-shelf");
const autoOpen = () => page.getByTestId("swarm-board-auto-open");
const autoOpenLabel = () => autoOpen().element().textContent ?? "";

interface Options {
	/** What kilo.core/swarm read from the user's config; null while unread. */
	readonly enabled: boolean | null;
	/** `setEnabled` fails with this message. */
	readonly failWith?: string;
}

/** kilo.shell with kilo.core's swarm faked and kilo.chat's settings section, on Settings → Swarm Board. */
async function showSettings(options: Options) {
	const writes: boolean[] = [];
	let swarm: DomainObjectProvider<typeof Swarm> | undefined;
	const host = await renderShell(
		[
			{
				manifest,
				definitions: CHAT_DEFINITIONS,
				web: { activate: (sdk: PluginSdk) => implementSwarmSettings(sdk) },
			},
		],
		{
			core: (sdk) => {
				sdk.context.set("termsAccepted", true);
				swarm = sdk.domainObjects.provide(Swarm, {
					initialState: { boardEvents: true, team: true, enabled: options.enabled },
					methods: {
						board: () => {
							throw new KernelError("UNAVAILABLE", "Not in this test.");
						},
						reset: () => {
							throw new KernelError("UNAVAILABLE", "Not in this test.");
						},
						team: () => null,
						jobs: () => [],
						cancelJob: () => undefined,
						usage: () => null,
						setEnabled: ({ enabled }) => {
							if (options.failWith) throw new KernelError("BUSINESS", options.failWith);
							writes.push(enabled);
							swarm!.setState({ ...swarm!.state, enabled });
						},
					},
				});
			},
		},
	);
	await host.renderer.kernelSdk.domainObjects
		.get(Navigation)!
		.methods.openSettings({ section: SWARM_SETTINGS_SECTION });
	await expect.element(page.getByTestId("swarm-settings")).toBeVisible();
	return { host, writes, swarm: () => swarm! };
}

beforeEach(() => {
	useSwarmPreferences.setState(DEFAULT_SWARM_PREFERENCES);
});

describe("Settings → Swarm Board", () => {
	it("turns Kilo's shared agent board off and on", async () => {
		const { writes } = await showSettings({ enabled: true });

		await expect.element(enabledSwitch()).toBeChecked();
		await enabledSwitch().click();

		await expect.element(enabledSwitch()).not.toBeChecked();
		expect(writes).toEqual([false]);

		await enabledSwitch().click();
		await expect.element(enabledSwitch()).toBeChecked();
		expect(writes).toEqual([false, true]);
	});

	it("waits for Kilo's setting before it can be changed", async () => {
		const { swarm } = await showSettings({ enabled: null });

		await expect.element(enabledSwitch()).toBeDisabled();

		swarm().setState({ ...swarm().state, enabled: false });

		await expect.element(enabledSwitch()).toBeEnabled();
		await expect.element(enabledSwitch()).not.toBeChecked();
	});

	it("keeps the setting and says why when Kilo refuses the change", async () => {
		await showSettings({ enabled: true, failWith: "The config file is read-only." });

		await enabledSwitch().click();

		await expect.element(page.getByText("The config file is read-only.")).toBeVisible();
		await expect.element(enabledSwitch()).toBeChecked();
	});

	it("saves when the board opens by itself and whether the composer shows the shelf", async () => {
		await showSettings({ enabled: true });

		await expect.poll(autoOpenLabel).toContain("Only for 3+ agents");
		await autoOpen().click();
		await page.getByTestId("swarm-board-auto-open-always").click();
		await expect.poll(autoOpenLabel).toContain("Always");

		await expect.element(shelfSwitch()).toBeChecked();
		await shelfSwitch().click();
		await expect.element(shelfSwitch()).not.toBeChecked();

		expect(useSwarmPreferences.getState()).toMatchObject({ autoOpen: "always", shelf: false });
	});

	it("sends notification choices to Settings → Notifications", async () => {
		await showSettings({ enabled: true });

		await page.getByTestId("swarm-board-notification-settings").click();

		await expect.poll(() => window.location.hash).toBe("#/settings/notifications");
	});
});
