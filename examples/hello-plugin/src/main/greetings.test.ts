import { afterEach, describe, expect, it } from "vitest";

import { definePlugin, KernelDataCollection, KernelTelemetrySink } from "@kilo-desktop/kernel";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import manifest from "../../plugin.json";
import { Greetings, HELLO_DEFINITIONS } from "../contracts";
import { helloMainEntry } from "./index";

const hosts: PluginHost[] = [];

async function bootHello() {
	const host = await createPluginHost([
		{ manifest, definitions: HELLO_DEFINITIONS, main: helloMainEntry },
	]);
	hosts.push(host);
	return host;
}

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

describe("greetings", () => {
	it("greets, counts and tells listeners", async () => {
		const host = await bootHello();
		const greetings = host.renderer.kernelSdk.domainObjects.get(Greetings)!;
		const heard: string[] = [];
		greetings.on("greeted", ({ name }) => heard.push(name));

		await expect(host.invoke(Greetings, "greet", { name: " Ada " })).resolves.toBe("Hello, Ada!");

		await expect.poll(() => greetings.getState()).toEqual({ count: 1, last: "Ada" });
		await expect.poll(() => heard).toEqual(["Ada"]);
	});

	it("starts again from zero after a reset", async () => {
		const host = await bootHello();
		await host.invoke(Greetings, "greet", { name: "Ada" });

		await host.invoke(Greetings, "reset", undefined);

		const greetings = host.renderer.kernelSdk.domainObjects.get(Greetings)!;
		await expect.poll(() => greetings.getState()).toEqual({ count: 0, last: null });
	});

	it("reports each greeting to telemetry sinks, with consent", async () => {
		const delivered: string[] = [];
		const sink = {
			manifest: {
				manifestVersion: 1,
				id: "example.sink",
				displayName: "Sink",
				version: "1.0.0",
				contributes: { extensions: { "kernel/telemetry-sink": [{ id: "sink" }] } },
			},
			main: definePlugin({
				activate: (sdk) =>
					void sdk.extensions.implement(KernelTelemetrySink, "sink", {
						deliver: (envelope) => void delivered.push(envelope.name),
					}),
			}),
		};
		const host = await createPluginHost([
			{ manifest, definitions: HELLO_DEFINITIONS, main: helloMainEntry },
			sink,
		]);
		hosts.push(host);
		host.main.kernelSdk.domainObjects.provide(KernelDataCollection, {
			initialState: { choice: true, allowed: true, installationId: "i", environment: "stable" },
			methods: { setChoice: () => {} },
		});

		await host.invoke(Greetings, "greet", { name: "Ada" });

		await expect.poll(() => delivered).toEqual(["Hello Greeted"]);
	});

	it("refuses an empty name", async () => {
		const host = await bootHello();

		await expect(host.invoke(Greetings, "greet", { name: "  " })).rejects.toMatchObject({
			code: "VALIDATION",
		});
	});
});
