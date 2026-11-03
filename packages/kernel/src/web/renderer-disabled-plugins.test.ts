import { describe, expect, it, vi } from "vitest";

import { KernelCommand } from "../builtins";
import { createMainKernel } from "../main/main-kernel";
import { createTestHost, testPlugin } from "../testing";
import { createLinkedTransports } from "../transport";
import { createRendererKernel } from "./renderer-kernel";

describe("renderer kernel with plugins turned off", () => {
	it("activates neither the web entry nor the contributions of a plugin main turned off", async () => {
		const transports = createLinkedTransports();
		const main = createMainKernel({
			host: createTestHost({
				plugins: { loadDisabled: () => ["acme.off"], saveDisabled: () => {} },
			}),
			transport: transports.main,
			registrations: [testPlugin("acme.off"), testPlugin("acme.on")],
		});
		await main.start();
		const activateOff = vi.fn();
		const activateOn = vi.fn();
		const renderer = createRendererKernel({
			windowId: "main",
			platform: "mac",
			transport: transports.connectRenderer("main"),
			registrations: [
				testPlugin("acme.off", {
					manifest: {
						contributes: { extensions: { [KernelCommand.id]: [{ id: "go", title: "Go" }] } },
					},
					entry: { activate: activateOff },
				}),
				testPlugin("acme.on", { entry: { activate: activateOn } }),
			],
		});

		await renderer.activate();

		expect(activateOff).not.toHaveBeenCalled();
		expect(activateOn).toHaveBeenCalled();
		expect(renderer.pluginState("acme.off")).toBe("disabled");
		expect(renderer.extensions.all(KernelCommand).map((command) => command.key)).not.toContain(
			"acme.off/go",
		);
	});
});
