import { afterEach, describe, expect, it } from "vitest";

import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import manifest from "../../plugin.json";
import { Greetings, HELLO_DEFINITIONS } from "../contracts";
import { helloMainEntry } from "../main";
import { helloWebEntry } from "./index";

const hosts: PluginHost[] = [];

async function bootHello() {
	const host = await createPluginHost([
		{ manifest, definitions: HELLO_DEFINITIONS, main: helloMainEntry, web: helloWebEntry },
	]);
	hosts.push(host);
	return host;
}

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

describe("Say hello", () => {
	it("greets the world from the command", async () => {
		const host = await bootHello();

		await host.renderer.commands.execute("example.hello/say-hello");
		await host.renderer.commands.execute("example.hello/say-hello");

		const greetings = host.renderer.kernelSdk.domainObjects.get(Greetings)!;
		await expect.poll(() => greetings.getState()).toEqual({ count: 2, last: "world" });
	});
});
