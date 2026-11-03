import { describe, expect, it } from "vitest";

import { createMainKernel } from "./main/main-kernel";
import { createTestHost, testPlugin } from "./testing";
import { mainHost } from "./host-services";
import { createRendererKernel } from "./web/renderer-kernel";

describe("mainHost", () => {
	it("gives main-process plugins their injected host services", async () => {
		const storage = { dir: "/data/acme.app", kv: () => ({}) };
		const kernel = createMainKernel({
			host: createTestHost(),
			registrations: [testPlugin("acme.app", { entry: { activate: () => {} } })],
			hostServices: () => ({ storage }),
		});
		await kernel.start();

		expect(mainHost(kernel.sdkFor("acme.app")).storage).toBe(storage);
	});

	it("is not available in a renderer", async () => {
		const kernel = createRendererKernel({
			windowId: "w1",
			platform: "mac",
			registrations: [testPlugin("acme.app", { entry: { activate: () => {} } })],
		});
		await kernel.activate();

		expect(() => mainHost(kernel.sdkFor("acme.app"))).toThrow(/main process/);
	});
});
