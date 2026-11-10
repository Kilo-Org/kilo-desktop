import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineExtensionPoint } from "../extension-point";
import type { PluginHostServices } from "../sdk";
import { testPlugin } from "../test-fixtures";
import { createTestHost } from "../testing";
import { createMainKernel } from "./main-kernel";

const Server = defineExtensionPoint({
	id: "acme.host/server",
	kind: "additive",
	resources: true,
	metadata: z.object({ command: z.string(), args: z.array(z.string()).default([]) }),
});
const Plain = defineExtensionPoint({
	id: "acme.host/plain",
	kind: "additive",
	metadata: z.object({ command: z.string() }),
});

const host = testPlugin("acme.host", {
	manifest: {
		extensionPoints: [
			{ id: "server", kind: "additive" },
			{ id: "plain", kind: "additive" },
		],
	},
	definitions: { extensionPoints: [Server, Plain] },
	entry: { activate: () => {} },
});

const contributor = testPlugin("acme.tools", {
	manifest: {
		contributes: {
			extensions: {
				"acme.host/server": [
					{ id: "s", command: "${resources}/bin/server", args: ["--root", "${resources}"] },
				],
				"acme.host/plain": [{ id: "p", command: "${resources}/bin/server" }],
			},
		},
	},
	entry: { activate: () => {} },
});

/** Each plugin's assets resolve under its own folder, as the host's do. */
const assetsByPlugin = (pluginId: string) =>
	({
		assets: { resolve: (subpath: string) => `/plugins/${pluginId}/${subpath}` },
	}) as unknown as PluginHostServices;

describe("contribution resources", () => {
	it("expands ${resources} to the contributing plugin's folder, for points that ask for it", async () => {
		const kernel = createMainKernel({
			registrations: [host, contributor],
			host: createTestHost(),
			hostServices: assetsByPlugin,
		});
		await kernel.start();
		const sdk = kernel.sdkFor("acme.host");

		expect(sdk.extensions.list(Server)[0]!.metadata).toEqual({
			command: "/plugins/acme.tools/resources/bin/server",
			args: ["--root", "/plugins/acme.tools/resources"],
		});
		expect(sdk.extensions.list(Plain)[0]!.metadata.command).toBe("${resources}/bin/server");
	});

	it("leaves the token when the host has no assets for the contributor", async () => {
		const warnings: string[] = [];
		const kernel = createMainKernel({
			registrations: [host, contributor],
			host: createTestHost(),
			logger: { debug() {}, info() {}, warn: (message) => void warnings.push(message), error() {} },
		});
		await kernel.start();

		expect(kernel.sdkFor("acme.host").extensions.list(Server)[0]!.metadata.command).toBe(
			"${resources}/bin/server",
		);
		expect(warnings).toEqual([expect.stringContaining("acme.tools/s")]);
	});
});
