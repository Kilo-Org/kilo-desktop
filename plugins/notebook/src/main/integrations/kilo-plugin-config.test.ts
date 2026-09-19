import { describe, expect, it, vi } from "vitest";

import { createLinkedFakeSdkPair } from "@kilo-desktop/testing";

import { reconcileNotebookKiloPlugin } from "./kilo-plugin-config.js";

describe("notebook Kilo plugin configuration", () => {
	it("declares the direct binding plugin as the notebook source's complete Kilo state", async () => {
		const { mainSdk: kiloServerSdk, createMainSdk } = createLinkedFakeSdkPair({
			featureId: "kilo-server",
		});
		const disposeEnv = vi.fn();
		const kiloService = {
			configuration: {
				set: vi.fn(async () => undefined),
			},
			serverEnv: {
				contribute: vi.fn(() => disposeEnv),
			},
		};
		kiloServerSdk.plugins.expose("kiloService", kiloService);
		const notebookSdk = createMainSdk("notebook");

		const dispose = await reconcileNotebookKiloPlugin(notebookSdk, {
			pluginPath: "/plugins/notebook/build/kilo-plugin/index.js",
			runtimedNodePath: "/app.asar.unpacked/node_modules/@runtimed/node/src/index.cjs",
			socketPath: "/tmp/runtimed.sock",
		});

		expect(kiloService.configuration.set).toHaveBeenCalledWith("notebook", {
			plugins: {
				notebooks: "/plugins/notebook/build/kilo-plugin/index.js",
			},
			mcpEntries: {},
		});
		expect(kiloService.serverEnv.contribute).toHaveBeenCalledWith("notebook", {
			NTERACT_RUNTIMED_NODE_PATH: "/app.asar.unpacked/node_modules/@runtimed/node/src/index.cjs",
			RUNTIMED_SOCKET_PATH: "/tmp/runtimed.sock",
		});
		dispose();
		expect(disposeEnv).toHaveBeenCalledOnce();
		kiloServerSdk.dispose();
	});

	it("skips configuration when the kilo-server capability is unavailable", async () => {
		const { createMainSdk } = createLinkedFakeSdkPair({ featureId: "kilo-server" });
		const notebookSdk = createMainSdk("notebook");
		const warn = vi.fn();

		const dispose = await reconcileNotebookKiloPlugin(notebookSdk, {
			pluginPath: "/plugins/notebook/build/kilo-plugin/index.js",
			runtimedNodePath: "/runtimed/node",
			socketPath: "/tmp/runtimed.sock",
			logger: { warn },
		});

		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("kilo-server capability is unavailable"),
		);
		expect(dispose()).toBeUndefined();
	});
});
