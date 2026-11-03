import { afterEach, describe, expect, it } from "vitest";
import { page } from "vitest/browser";

import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";
import shellManifest from "@kilo-desktop/plugin-shell/plugin.json";
import {
	SettingsSection,
	SHELL_DOMAINS,
	SHELL_EXTENSION_POINTS,
} from "@kilo-desktop/plugin-shell/contracts";

import manifest from "../../plugin.json";
import { HELLO_DEFINITIONS } from "../contracts";
import { helloMainEntry } from "../main";
import { helloWebEntry } from "./index";

const hosts: PluginHost[] = [];

/** kilo.shell only as the point's owner (manifest and contracts); example.hello in full. */
async function bootHello() {
	const host = await createPluginHost([
		{
			manifest: shellManifest,
			definitions: { extensionPoints: SHELL_EXTENSION_POINTS, domains: SHELL_DOMAINS },
		},
		{ manifest, definitions: HELLO_DEFINITIONS, main: helloMainEntry, web: helloWebEntry },
	]);
	hosts.push(host);
	return host;
}

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

describe("Settings → Hello", () => {
	it("counts greetings and resets them", async () => {
		const host = await bootHello();
		const slot = host.renderSlot(SettingsSection, {}, { select: (impl) => impl.component });

		await expect.element(page.getByTestId("hello-count")).toHaveTextContent("No greetings yet.");
		expect(slot.keys()).toEqual(["example.hello/hello"]);

		await page.getByTestId("hello-say-hello").click();
		await expect
			.element(page.getByTestId("hello-count"))
			.toHaveTextContent("1 greeting, the last to world.");

		await page.getByTestId("hello-reset").click();
		await expect.element(page.getByTestId("hello-count")).toHaveTextContent("No greetings yet.");
	});

	it("says hello from the command too", async () => {
		const host = await bootHello();
		host.renderSlot(SettingsSection, {}, { select: (impl) => impl.component });

		await host.renderer.commands.execute("example.hello/say-hello");
		await host.renderer.commands.execute("example.hello/say-hello");

		await expect
			.element(page.getByTestId("hello-count"))
			.toHaveTextContent("2 greetings, the last to world.");
	});
});
