import { describe, expect, it, vi } from "vitest";

import { definePlugin, type PluginRegistration } from "@kilo-desktop/kernel";
import { createMainKernel } from "@kilo-desktop/kernel/main";
import { createTestHost, testPlugin } from "@kilo-desktop/kernel/testing";

import manifest from "../../../plugin.json";
import {
	CORE_DEFINITIONS,
	KiloServer,
	KiloWorkStyle,
	type ServerConnection,
} from "../../contracts";
import { activateWorkStyle } from "./index";
import { createFakeWorkStyleClient, type FakeWorkStyleClient } from "./test-work-style-client";
import { REVIEW_FIRST_PERMISSION, type PermissionConfig } from "./work-style-presets";

const CONNECTION: ServerConnection = {
	baseUrl: "http://127.0.0.1:4096",
	username: "kilo",
	password: "pw",
	version: "7.8.27",
	globalDirectory: "/home",
};

interface BootOptions {
	readonly permission?: PermissionConfig;
	/** Leaves kilo.core/server unprovided. */
	readonly withoutServer?: boolean;
}

/** kilo.core's work-style area in a main kernel, with a fake of kilo.core's server. */
async function bootWorkStyle(options: BootOptions = {}) {
	const fake: FakeWorkStyleClient = createFakeWorkStyleClient(options.permission);
	const connect = vi.fn(() => CONNECTION);
	const createClient = vi.fn(() => fake.client);
	const core: PluginRegistration = {
		manifest,
		definitions: CORE_DEFINITIONS,
		entry: definePlugin({
			activate(sdk) {
				if (!options.withoutServer) {
					sdk.domainObjects.provide(KiloServer, {
						initialState: { status: "ready" },
						methods: {
							connect,
							restart: () => undefined,
							disposeInstance: () => undefined,
							userConfigFile: () => ({ path: "/home/.config/kilo/kilo.json", exists: false }),
						},
					});
				}
				activateWorkStyle(sdk, { createClient });
			},
		}),
	};
	const kernel = createMainKernel({
		host: createTestHost(),
		registrations: [core, testPlugin("kilo.shell"), testPlugin("acme.other")],
	});
	await kernel.start();
	const asPlugin = (pluginId: string) => kernel.sdkFor(pluginId).domainObjects.get(KiloWorkStyle)!;
	return {
		fake,
		connect,
		createClient,
		workStyle: kernel.kernelSdk.domainObjects.get(KiloWorkStyle)!,
		asShell: asPlugin("kilo.shell"),
		asOther: asPlugin("acme.other"),
	};
}

describe("kilo.core/work-style", () => {
	it("starts with no style applied", async () => {
		const { workStyle } = await bootWorkStyle();
		expect(workStyle.getState()).toEqual({ style: null });
	});

	it("reports the permission keys Review first would replace, through the server's connection", async () => {
		const { asShell, connect, createClient } = await bootWorkStyle({
			permission: { bash: "allow", mcp_tool: "allow" },
		});

		await expect(asShell.methods.conflicts(undefined)).resolves.toEqual({ keys: ["bash"] });
		expect(connect).toHaveBeenCalledOnce();
		expect(createClient).toHaveBeenCalledWith(CONNECTION);
	});

	it("writes Review first and records the style", async () => {
		const { asShell, fake } = await bootWorkStyle({ permission: { edit: "allow" } });

		await asShell.methods.apply({ style: "human-in-the-loop" });

		expect(fake.permission).toEqual(REVIEW_FIRST_PERMISSION);
		expect(fake.calls).toEqual(["read", "update", "dispose"]);
		expect(asShell.getState()).toEqual({ style: "human-in-the-loop" });
		await expect(asShell.methods.conflicts(undefined)).resolves.toEqual({ keys: [] });
	});

	it("restores the replaced rules when switching back to High autonomy in the same session", async () => {
		const { asShell, fake } = await bootWorkStyle({ permission: { edit: "allow" } });

		await asShell.methods.apply({ style: "human-in-the-loop" });
		await asShell.methods.apply({ style: "autonomous" });

		expect(fake.permission).toEqual({ edit: "allow" });
		expect(asShell.getState()).toEqual({ style: "autonomous" });
	});

	it("leaves the user's config alone for High autonomy without an earlier Review first", async () => {
		const { asShell, fake } = await bootWorkStyle({ permission: REVIEW_FIRST_PERMISSION });

		await asShell.methods.apply({ style: "autonomous" });

		expect(fake.updates).toEqual([]);
		expect(fake.permission).toEqual(REVIEW_FIRST_PERMISSION);
		expect(asShell.getState()).toEqual({ style: "autonomous" });
	});

	it("runs applies one at a time, each planning from the config the last one wrote", async () => {
		const { asShell, fake } = await bootWorkStyle({ permission: { edit: "allow" } });

		await Promise.all([
			asShell.methods.apply({ style: "human-in-the-loop" }),
			asShell.methods.apply({ style: "autonomous" }),
		]);

		expect(fake.permission).toEqual({ edit: "allow" });
		expect(asShell.getState()).toEqual({ style: "autonomous" });
	});

	it("keeps the last style when a write fails, and a retry still works", async () => {
		const { asShell, fake } = await bootWorkStyle();
		fake.failNextUpdate = new Error("Config is read-only.");

		await expect(asShell.methods.apply({ style: "human-in-the-loop" })).rejects.toThrow(
			"Config is read-only.",
		);
		expect(asShell.getState()).toEqual({ style: null });

		await asShell.methods.apply({ style: "human-in-the-loop" });
		expect(asShell.getState()).toEqual({ style: "human-in-the-loop" });
	});

	it("explains a failure Kilo gave no reason for", async () => {
		const { asShell, fake } = await bootWorkStyle();
		fake.failNextUpdate = new Error("");

		await expect(asShell.methods.apply({ style: "human-in-the-loop" })).rejects.toThrow(
			"Could not save your work style.",
		);
	});

	it("lets the main kernel set the style", async () => {
		const { workStyle } = await bootWorkStyle();
		await workStyle.methods.apply({ style: "human-in-the-loop" });
		expect(workStyle.getState()).toEqual({ style: "human-in-the-loop" });
	});

	it("refuses other plugins", async () => {
		const { asOther, fake } = await bootWorkStyle();

		await expect(asOther.methods.apply({ style: "human-in-the-loop" })).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		await expect(asOther.methods.conflicts(undefined)).rejects.toMatchObject({
			code: "PERMISSION_DENIED",
		});
		expect(fake.calls).toEqual([]);
	});

	it("is unavailable without the Kilo server", async () => {
		const { asShell } = await bootWorkStyle({ withoutServer: true });
		await expect(asShell.methods.conflicts(undefined)).rejects.toMatchObject({
			code: "UNAVAILABLE",
		});
	});
});
