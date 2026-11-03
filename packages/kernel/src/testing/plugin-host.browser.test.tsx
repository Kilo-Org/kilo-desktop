import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import { z } from "zod";

import { defineDomain, method } from "../domain";
import { defineExtensionPoint, implementation } from "../extension-point";
import { useSdk } from "../web/react";
import { testManifest } from "./index";
import { createPluginHost, type PluginHost } from "./plugin-host";

const Badge = defineExtensionPoint({
	id: "acme.host/badge",
	kind: "additive",
	implementation: implementation<ComponentType<{ readonly label: string }>>("renderer"),
});

const Panel = defineExtensionPoint({
	id: "acme.host/panel",
	kind: "additive",
	implementation: implementation<{ readonly component: ComponentType }>("renderer"),
});

const Counter = defineDomain({
	id: "acme.guest/counter",
	home: "main",
	state: z.object({}),
	methods: {
		add: method(z.object({ by: z.number() }), z.number()),
		caller: method(z.undefined(), z.string()),
	},
});

/** The points' owner, present only through its manifest and definitions. */
const owner = {
	manifest: testManifest("acme.host", {
		extensionPoints: [
			{ id: "badge", kind: "additive" },
			{ id: "panel", kind: "additive" },
		],
	}),
	definitions: { extensionPoints: [Badge, Panel] },
};

function WhoAmI({ label }: { readonly label: string }) {
	return <span data-qa-id="badge">{`${label} from ${useSdk().pluginId}`}</span>;
}

const guest = {
	manifest: testManifest("acme.guest", {
		domains: [{ id: "counter", home: "main" }],
		contributes: {
			extensions: {
				"acme.host/badge": [{ id: "second" }, { id: "first", priority: 1 }],
				"acme.host/panel": [{ id: "panel" }],
			},
		},
	}),
	definitions: { domains: [Counter] },
};

let host: PluginHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

async function boot() {
	host = await createPluginHost([
		owner,
		{
			manifest: guest.manifest,
			definitions: guest.definitions,
			main: {
				activate: (sdk) => {
					let total = 0;
					sdk.domains.provide(Counter, {
						initialState: {},
						methods: {
							add: ({ by }) => (total += by),
							caller: (_input, caller) => `${caller.pluginId} (${caller.process})`,
						},
					});
				},
			},
			web: {
				activate: (sdk) => {
					sdk.extensions.implement(Badge, "first", WhoAmI);
					sdk.extensions.implement(Badge, "second", WhoAmI);
					sdk.extensions.implement(Panel, "panel", {
						component: () => <p data-qa-id="panel">Panel</p>,
					});
				},
			},
		},
	]);
	return host;
}

describe("createPluginHost", () => {
	it("renders every contribution to a point inside its plugin's sdk, in point order", async () => {
		const slot = (await boot()).renderSlot(Badge, { label: "Hi" });

		await expect.element(page.getByTestId("badge").first()).toHaveTextContent("Hi from acme.guest");
		expect(slot.keys()).toEqual(["acme.guest/first", "acme.guest/second"]);

		slot.unmount();
		expect(slot.container.isConnected).toBe(false);
	});

	it("picks components out of implementation objects and accepts a point id", async () => {
		(await boot()).renderSlot("acme.host/panel", undefined, {
			select: (impl: { component: ComponentType }) => impl.component,
		});

		await expect.element(page.getByTestId("panel")).toBeVisible();
	});

	it("invokes domain methods by definition or id, and refuses an unprovided domain", async () => {
		const booted = await boot();

		expect(await booted.invoke(Counter, "add", { by: 2 })).toBe(2);
		expect(await booted.invoke("acme.guest/counter", "add", { by: 3 })).toBe(5);
		await expect(booted.invoke("acme.guest/missing", "add")).rejects.toThrow(/No plugin provides/);
	});

	it("invokes as the window's kernel, or as a plugin that runs in the window", async () => {
		const booted = await boot();

		expect(await booted.invoke(Counter, "caller", undefined)).toBe("kernel (renderer)");
		expect(await booted.invoke(Counter, "caller", undefined, { as: "acme.guest" })).toBe(
			"acme.guest (renderer)",
		);
		await expect(
			booted.invoke(Counter, "caller", undefined, { as: "acme.host" }),
		).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
		await expect(
			booted.invoke(Counter, "caller", undefined, { as: "acme.absent" }),
		).rejects.toMatchObject({ code: "UNAVAILABLE" });
	});
});
