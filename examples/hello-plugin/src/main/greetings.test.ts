import { afterEach, describe, expect, it } from "vitest";

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
		const greetings = host.renderer.kernelSdk.domains.get(Greetings)!;
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

		const greetings = host.renderer.kernelSdk.domains.get(Greetings)!;
		await expect.poll(() => greetings.getState()).toEqual({ count: 0, last: null });
	});

	it("refuses an empty name", async () => {
		const host = await bootHello();

		await expect(host.invoke(Greetings, "greet", { name: "  " })).rejects.toMatchObject({
			code: "VALIDATION",
		});
	});
});
