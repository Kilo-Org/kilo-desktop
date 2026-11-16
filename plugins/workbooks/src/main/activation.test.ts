import { afterEach, describe, expect, it } from "vitest";

import { KernelPlugins } from "@kilo-desktop/kernel";
import { createPluginHost, type PluginHost } from "@kilo-desktop/kernel/testing/plugin-host";

import manifest from "../../plugin.json";
import { WORKBOOKS_DEFINITIONS, WORKBOOKS_PLUGIN_ID } from "../contracts";
import { workbooksWebEntry } from "../web";
import { workbooksMainEntry } from "./index";

const hosts: PluginHost[] = [];

afterEach(async () => {
	await Promise.all(hosts.splice(0).map((host) => host.dispose()));
});

describe("kilo.workbooks", () => {
	it("activates in main and in the window", async () => {
		const host = await createPluginHost([
			{
				manifest,
				definitions: WORKBOOKS_DEFINITIONS,
				main: workbooksMainEntry,
				web: workbooksWebEntry,
			},
		]);
		hosts.push(host);

		const plugins = host.main.kernelSdk.domainObjects.get(KernelPlugins)!;
		await expect.poll(() => plugins.getState().plugins[WORKBOOKS_PLUGIN_ID]?.state).toBe("active");
	});
});
