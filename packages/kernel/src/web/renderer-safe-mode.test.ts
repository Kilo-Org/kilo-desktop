import { describe, expect, it, vi } from "vitest";

import { createMainKernel } from "../main/main-kernel";
import { createTestHost, testPlugin } from "../testing";
import { createLinkedTransports } from "../transport";
import { createRendererKernel } from "./renderer-kernel";

describe("renderer kernel in safe mode", () => {
	it("activates no plugins when main started in safe mode", async () => {
		const transports = createLinkedTransports();
		const main = createMainKernel({
			host: createTestHost({ safeMode: true }),
			transport: transports.main,
			registrations: [testPlugin("acme.ui")],
		});
		await main.start();
		const activate = vi.fn();
		const renderer = createRendererKernel({
			windowId: "main",
			platform: "mac",
			transport: transports.connectRenderer("main"),
			registrations: [testPlugin("acme.ui", { entry: { activate } })],
		});

		await renderer.activate();

		expect(activate).not.toHaveBeenCalled();
		expect(renderer.pluginState("acme.ui")).toBe("resolved");
	});
});
