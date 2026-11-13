import { expect } from "vitest";
import { page } from "vitest/browser";
import { z } from "zod";

import { defineDomainObject, type DomainObjectProvider } from "@kilo-desktop/kernel";
import { testManifest } from "@kilo-desktop/kernel/testing";
import { contributor, renderShell, type GuestPlugin } from "@kilo-desktop/plugin-shell/testing";

import manifest from "../../plugin.json";
import { DOMAIN_MAP_DEFINITIONS } from "../contracts";
import { domainMapWebEntry } from "../web";

export const domainMap: GuestPlugin = {
	manifest,
	definitions: DOMAIN_MAP_DEFINITIONS,
	web: domainMapWebEntry,
};

/** Declares the `developer` flag the map runs behind, as kilo.developer does in the app. */
export const developerFlag = contributor("acme.flags", {
	"kernel/flag": [{ id: "developer", description: "Developer tools.", default: false }],
});

export const Clock = defineDomainObject({
	id: "acme.ticker/clock",
	home: "main",
	description: "Ticks when told to.",
	state: z.object({ ticks: z.number() }),
	events: { tick: z.object({ ticks: z.number() }) },
});

/** A main plugin owning the clock, and a handle to make it tick from the test. */
export function ticker() {
	let provider: DomainObjectProvider<typeof Clock> | undefined;
	const plugin: GuestPlugin = {
		manifest: testManifest("acme.ticker", { domainObjects: [{ id: "clock", home: "main" }] }),
		definitions: { domainObjects: [Clock] },
		main: {
			activate: (sdk) => {
				provider = sdk.domainObjects.provide(Clock, { initialState: { ticks: 0 }, methods: {} });
			},
		},
	};
	const tick = () => {
		const ticks = provider!.state.ticks + 1;
		provider!.setState({ ticks });
		provider!.emit("tick", { ticks });
	};
	return { plugin, tick };
}

/** A window-only plugin declaring it uses the clock. */
export const listener: GuestPlugin = contributor("acme.listener", {}, () => {}, {
	requires: { "acme.ticker/clock": "optional" },
});

export const PANEL = "right-sidebar-panel-kilo.domain-map/domain-map";

/** Boots the shell with the map (flag on) and opens it from its icon in the right sidebar's rail. */
export async function openDomainMap(plugins: readonly GuestPlugin[]) {
	await page.viewport(1600, 1000);
	const host = await renderShell([developerFlag, domainMap, ...plugins], {
		flags: { developer: true },
	});
	await page.getByTestId(PANEL).click();
	await expect.element(page.getByTestId("domain-map-panel")).toBeVisible();
	return host;
}
